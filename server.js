
const express = require("express");
const cors = require("cors");
const chromeLauncher = require("chrome-launcher");
const chromium = require("@sparticuz/chromium");
const dns = require("dns").promises;
const net = require("net");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Health Check
app.get("/", (req, res) => {
    res.json({
        name: "Health Checker",
        status: "online",
        version: "3.1"
    });
});

// Private IP Protection
function isPrivateIP(ip) {
    if (net.isIPv4(ip)) {
        const p = ip.split(".").map(Number);

        return (
            p[0] === 10 ||
            p[0] === 127 ||
            p[0] === 0 ||
            (p[0] === 169 && p[1] === 254) ||
            (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
            (p[0] === 192 && p[1] === 168)
        );
    }

    if (net.isIPv6(ip)) {
        const value = ip.toLowerCase();

        return (
            value === "::1" ||
            value === "::" ||
            value.startsWith("fe80:") ||
            value.startsWith("fc") ||
            value.startsWith("fd") ||
            value.startsWith("::ffff:127.") ||
            value.startsWith("::ffff:10.") ||
            value.startsWith("::ffff:192.168.")
        );
    }

    return true;
}

// URL Validation
async function validateURL(input) {
    let parsed;

    try {
        parsed = new URL(input);
    } catch {
        throw new Error("Please enter a valid website URL.");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Only HTTP and HTTPS websites are supported.");
    }

    if (parsed.username || parsed.password) {
        throw new Error("Website URLs containing credentials are not allowed.");
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal")
    ) {
        throw new Error("Local websites cannot be analyzed.");
    }

    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname)) {
            throw new Error("Private IP addresses cannot be analyzed.");
        }
    } else {
        let records;

        try {
            records = await dns.lookup(hostname, {
                all: true,
                verbatim: true
            });
        } catch {
            throw new Error("Website domain could not be resolved.");
        }

        if (!records.length) {
            throw new Error("No IP address found for this website.");
        }

        if (records.some(record => isPrivateIP(record.address))) {
            throw new Error("This website resolves to a private IP address.");
        }
    }

    return parsed.href;
}

// Compatibility with different Chromium package API versions
async function getChromiumPath() {
    const path = chromium.executablePath;

    if (typeof path === "function") {
        return await path.call(chromium);
    }

    if (path) {
        return await path;
    }

    throw new Error("Chromium executable path is unavailable.");
}

// Audit Issue Formatter
function getAuditIssues(category) {
    if (!category || !category.auditRefs) {
        return [];
    }

    return category.auditRefs
        .filter(ref => {
            const audit = ref.result;

            return (
                audit &&
                audit.score !== null &&
                audit.score !== undefined &&
                audit.score < 1 &&
                ref.weight > 0
            );
        })
        .map(ref => {
            const audit = ref.result;

            return {
                id: audit.id,
                title: audit.title || "Website issue",
                description:
                    audit.description ||
                    "This audit identified an issue that may affect your website.",
                explanation:
                    audit.displayValue ||
                    "This check did not achieve a perfect score.",
                score: Math.round((audit.score || 0) * 100),
                severity: audit.score <= 0.5 ? "High" : "Medium",
                help: audit.details?.items || [],
                learnMore: audit.description || ""
            };
        });
}

// Main Analysis API
app.post("/analyze", async (req, res) => {
    let chrome;

    try {
        const { url } = req.body;

        if (!url || typeof url !== "string") {
            return res.status(400).json({
                success: false,
                error: "Please enter a website URL."
            });
        }

        let websiteURL = url.trim();

        if (!/^https?:\/\//i.test(websiteURL)) {
            websiteURL = "https://" + websiteURL;
        }

        websiteURL = await validateURL(websiteURL);

        console.log("Starting analysis:", websiteURL);

        const executablePath = await getChromiumPath();

        chrome = await chromeLauncher.launch({
            chromePath: executablePath,
            chromeFlags: [
                ...chromium.args,
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-setuid-sandbox"
            ],
            port: 0
        });

        const lighthouseModule = await import("lighthouse");
        const lighthouse = lighthouseModule.default;

        const report = await lighthouse(websiteURL, {
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
                mobile: false,
                width: 1350,
                height: 940,
                deviceScaleFactor: 1,
                disabled: false
            }
        });

        if (!report || !report.lhr) {
            throw new Error("Lighthouse could not generate a report.");
        }

        const lhr = report.lhr;
        const categories = lhr.categories;
        const audits = lhr.audits;

        const scores = {
            performance: Math.round(
                (categories.performance.score || 0) * 100
            ),

            seo: Math.round(
                (categories.seo.score || 0) * 100
            ),

            accessibility: Math.round(
                (categories.accessibility.score || 0) * 100
            )
        };

        const metrics = {
            firstContentfulPaint:
                audits["first-contentful-paint"]?.displayValue || "N/A",

            largestContentfulPaint:
                audits["largest-contentful-paint"]?.displayValue || "N/A",

            speedIndex:
                audits["speed-index"]?.displayValue || "N/A",

            totalBlockingTime:
                audits["total-blocking-time"]?.displayValue || "N/A",

            cumulativeLayoutShift:
                audits["cumulative-layout-shift"]?.displayValue || "N/A",

            timeToInteractive:
                audits["interactive"]?.displayValue || "N/A"
        };

        const issues = {
            performance: getAuditIssues(categories.performance),
            seo: getAuditIssues(categories.seo),
            accessibility: getAuditIssues(categories.accessibility)
        };

        const totalIssues =
            issues.performance.length +
            issues.seo.length +
            issues.accessibility.length;

        console.log("Analysis completed:", websiteURL);

        return res.json({
            success: true,
            website: websiteURL,
            title: lhr.finalDisplayedUrl || websiteURL,
            scores,
            metrics,
            issues,
            totalIssues,
            analyzedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error("Analysis error:", error);

        return res.status(500).json({
            success: false,
            error: error.message ||
                "Website analysis failed. Please try again."
        });

    } finally {
        if (chrome) {
            try {
                await chrome.kill();
            } catch (error) {
                console.error("Chrome cleanup error:", error.message);
            }
        }
    }
});

// Start Server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Health Checker running on port ${PORT}`);
});
