
const express = require("express");
const cors = require("cors");
const chromeLauncher = require("chrome-launcher");
const chromium = require("@sparticuz/chromium");
const dns = require("dns").promises;
const net = require("net");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 10000;

// Health Check
app.get("/", (req, res) => {
    res.json({
        name: "Health Checker",
        status: "online",
        version: "3.0"
    });
});

// Check for private/local IP addresses
function isPrivateIP(ip) {
    if (net.isIPv4(ip)) {
        const parts = ip.split(".").map(Number);

        return (
            parts[0] === 10 ||
            parts[0] === 127 ||
            parts[0] === 0 ||
            (parts[0] === 169 && parts[1] === 254) ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168
            )
        );
    }

    if (net.isIPv6(ip)) {
        const normalized = ip.toLowerCase();

        return (
            normalized === "::1" ||
            normalized === "::" ||
            normalized.startsWith("fe80:") ||
            normalized.startsWith("fc") ||
            normalized.startsWith("fd") ||
            normalized.startsWith("::ffff:127.") ||
            normalized.startsWith("::ffff:10.") ||
            normalized.startsWith("::ffff:192.168.")
        );
    }

    return true;
}

// Validate website URL
async function validateURL(input) {
    let parsedURL;

    try {
        parsedURL = new URL(input);
    } catch {
        throw new Error("Please enter a valid website URL.");
    }

    if (!["http:", "https:"].includes(parsedURL.protocol)) {
        throw new Error("Only HTTP and HTTPS websites are supported.");
    }

    if (
        parsedURL.username ||
        parsedURL.password
    ) {
        throw new Error("URLs containing login credentials are not allowed.");
    }

    const hostname = parsedURL.hostname.toLowerCase();

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
        let addresses;

        try {
            addresses = await dns.lookup(hostname, {
                all: true,
                verbatim: true
            });
        } catch {
            throw new Error("Website domain could not be resolved.");
        }

        if (!addresses.length) {
            throw new Error("No IP address found for this website.");
        }

        if (addresses.some((entry) => isPrivateIP(entry.address))) {
            throw new Error("This website resolves to a private IP address.");
        }
    }

    return parsedURL.href;
}

// Convert Lighthouse audits into simple explanations
function getAuditIssues(category) {
    if (!category || !category.auditRefs) {
        return [];
    }

    return category.auditRefs
        .filter((ref) => {
            const audit = ref.result;

            return (
                audit &&
                audit.score !== null &&
                audit.score !== undefined &&
                audit.score < 1 &&
                ref.weight > 0
            );
        })
        .map((ref) => {
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
                severity:
                    audit.score <= 0.5 ? "High" : "Medium",
                help: audit.details?.items || [],
                learnMore: audit.description || ""
            };
        });
}

// Main Website Analysis API
app.post("/analyze", async (req, res) => {
    let chrome;

    try {
        const { url } = req.body;

        if (!url || typeof url !== "string") {
            return res.status(400).json({
                error: "Please enter a website URL."
            });
        }

        let websiteURL = url.trim();

        if (!/^https?:\/\//i.test(websiteURL)) {
            websiteURL = "https://" + websiteURL;
        }

        websiteURL = await validateURL(websiteURL);

        console.log("Starting analysis:", websiteURL);

        // Launch Chromium
        chrome = await chromeLauncher.launch({
            chromePath: await chromium.executablePath(),
            chromeFlags: [
                ...chromium.args,
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-setuid-sandbox"
            ],
            port: 0
        });

        // Lighthouse is an ES module
        const lighthouseModule = await import("lighthouse");
        const lighthouse = lighthouseModule.default;

        // Run Lighthouse
        const report = await lighthouse(
            websiteURL,
            {
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
            }
        );

        if (!report || !report.lhr) {
            throw new Error("Lighthouse could not generate an audit report.");
        }

        const lhr = report.lhr;
        const categories = lhr.categories;
        const audits = lhr.audits;

        const performance = categories.performance;
        const seo = categories.seo;
        const accessibility = categories.accessibility;

        const scores = {
            performance: Math.round((performance.score || 0) * 100),
            seo: Math.round((seo.score || 0) * 100),
            accessibility: Math.round((accessibility.score || 0) * 100)
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
            performance: getAuditIssues(performance),
            seo: getAuditIssues(seo),
            accessibility: getAuditIssues(accessibility)
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
        console.error("Analysis error:", error.message);

        return res.status(500).json({
            success: false,
            error:
                error.message ||
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
    console.log(`Health Checker backend running on port ${PORT}`);
});
