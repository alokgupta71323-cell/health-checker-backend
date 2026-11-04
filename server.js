const express = require("express");
const cors = require("cors");
const chromeLauncher = require("chrome-launcher");
const dns = require("dns").promises;
const net = require("net");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10kb" }));

// Basic private/local IP protection
function isPrivateIP(ip) {
    if (net.isIPv4(ip)) {
        const parts = ip.split(".").map(Number);

        return (
            parts[0] === 0 ||
            parts[0] === 10 ||
            parts[0] === 127 ||
            parts[0] >= 224 ||
            (parts[0] === 169 && parts[1] === 254) ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168) ||
            (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
        );
    }

    if (net.isIPv6(ip)) {
        const normalized = ip.toLowerCase();

        return (
            normalized === "::" ||
            normalized === "::1" ||
            normalized.startsWith("fc") ||
            normalized.startsWith("fd") ||
            normalized.startsWith("fe80") ||
            normalized.startsWith("::ffff:127.") ||
            normalized.startsWith("::ffff:10.") ||
            normalized.startsWith("::ffff:192.168.")
        );
    }

    return true;
}

async function validatePublicURL(url) {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Only HTTP and HTTPS websites are supported.");
    }

    if (parsed.username || parsed.password) {
        throw new Error("URLs containing credentials are not allowed.");
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local")
    ) {
        throw new Error("Local websites cannot be analyzed.");
    }

    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname)) {
            throw new Error("Private IP addresses cannot be analyzed.");
        }

        return;
    }

    const addresses = await dns.lookup(hostname, {
        all: true,
        verbatim: true
    });

    if (!addresses.length) {
        throw new Error("Website hostname could not be resolved.");
    }

    if (addresses.some(item => isPrivateIP(item.address))) {
        throw new Error("Website resolves to a restricted IP address.");
    }
}

// Home
app.get("/", (req, res) => {
    res.json({
        name: "Health Checker",
        status: "online",
        version: "2.0"
    });
});

// Website Analysis
app.post("/analyze", async (req, res) => {
    let chrome;

    try {
        let url = req.body.url;

        if (!url || typeof url !== "string") {
            return res.status(400).json({
                success: false,
                error: "Please enter a valid website URL."
            });
        }

        url = url.trim();

        if (!/^https?:\/\//i.test(url)) {
            url = "https://" + url;
        }

        let parsedUrl;

        try {
            parsedUrl = new URL(url);
        } catch {
            return res.status(400).json({
                success: false,
                error: "The URL format is invalid."
            });
        }

        await validatePublicURL(url);

        console.log("Analyzing:", url);

        chrome = await chromeLauncher.launch({
            chromeFlags: [
                "--headless",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu"
            ]
        });

        console.log("Chrome launched. Starting Lighthouse...");

        const lighthouseModule = await import("lighthouse");
        const lighthouse = lighthouseModule.default;

        const result = await lighthouse(url, {
            port: chrome.port,
            output: "json",
            logLevel: "error",

            onlyCategories: [
                "performance",
                "seo",
                "accessibility"
            ],

            formFactor: "desktop",

            screenEmulation: {
                disabled: true
            }
        });

        if (!result || !result.lhr) {
            throw new Error("Lighthouse report unavailable.");
        }

        const report = result.lhr;
        const categories = report.categories;
        const reportAudits = report.audits;

        // Convert Lighthouse scores into percentages
        function getScore(category) {
            const score = categories[category]?.score;

            return score == null
                ? null
                : Math.round(score * 100);
        }

        // Category mapping for individual audits
        const auditCategories = {};

        Object.entries(categories).forEach(([categoryName, category]) => {
            category.auditRefs?.forEach(ref => {
                auditCategories[ref.id] = categoryName;
            });
        });

        // Detailed failed audits
        const audits = Object.values(reportAudits)
            .filter(audit =>
                audit.score !== null &&
                audit.score < 1 &&
                audit.title
            )
            .map(audit => ({
                id: audit.id,

                title: audit.title,

                description: audit.description || "",

                score: audit.score,

                displayValue: audit.displayValue || "",

                category:
                    auditCategories[audit.id] ||
                    audit.details?.type ||
                    "general",

                scoreDisplayMode:
                    audit.scoreDisplayMode || "numeric",

                numericValue:
                    audit.numericValue ?? null,

                numericUnit:
                    audit.numericUnit || "",

                details:
                    audit.details || null,

                warnings:
                    audit.warnings || [],

                errorMessage:
                    audit.errorMessage || null
            }));

        // Core Web Vitals and performance metrics
        function getMetric(id) {
            const audit = reportAudits[id];

            if (!audit) {
                return null;
            }

            return {
                value: audit.numericValue ?? null,
                displayValue: audit.displayValue || "",
                score: audit.score ?? null,
                description: audit.description || ""
            };
        }

        const metrics = {
            lcp: getMetric("largest-contentful-paint"),
            cls: getMetric("cumulative-layout-shift"),
            fcp: getMetric("first-contentful-paint"),
            tbt: getMetric("total-blocking-time"),
            speedIndex: getMetric("speed-index"),
            inp: getMetric("interaction-to-next-paint")
        };

        const response = {
            success: true,

            url: report.finalDisplayedUrl,

            requestedUrl: url,

            fetchTime: new Date().toISOString(),

            lighthouseVersion: report.lighthouseVersion,

            environment: {
                formFactor: report.configSettings?.formFactor || "desktop",
                throttlingMethod:
                    report.configSettings?.throttlingMethod || "unknown"
            },

            performance: getScore("performance"),

            seo: getScore("seo"),

            accessibility: getScore("accessibility"),

            metrics,

            audits
        };

        console.log("Analysis completed successfully!");

        res.json(response);

    } catch (error) {
        console.error("Analysis error:", error.message);

        res.status(500).json({
            success: false,
            error: error.message || "Website analysis failed."
        });

    } finally {
        if (chrome) {
            try {
                await chrome.kill();
                console.log("Chrome closed.");
            } catch (error) {
                console.error("Chrome cleanup error:", error.message);
            }
        }
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Health Checker running on port ${PORT}`);
});
