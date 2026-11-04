
const API_BASE_URL = "http://localhost:3000";

const analyzeForm = document.getElementById("analyzeForm");
const websiteUrlInput = document.getElementById("websiteUrl");
const analyzeBtn = document.getElementById("analyzeBtn");

const loadingOverlay = document.getElementById("loadingOverlay");
const loadingUrl = document.getElementById("loadingUrl");
const loadingStatus = document.getElementById("loadingStatus");
const loadingPercent = document.getElementById("loadingPercent");
const loadingProgressBar = document.getElementById("loadingProgressBar");

const resultsSection = document.getElementById("resultsSection");
const errorSection = document.getElementById("errorSection");
const errorMessage = document.getElementById("errorMessage");

const auditResults = document.getElementById("auditResults");
const issueCount = document.getElementById("issueCount");

const reanalyzeBtn = document.getElementById("reanalyzeBtn");
const errorRetryBtn = document.getElementById("errorRetryBtn");

let currentUrl = "";
let loadingTimer = null;
let loadingProgress = 0;
let currentStep = 0;

const loadingStages = [
  {
    id: "stepConnection",
    message: "Connecting to website..."
  },
  {
    id: "stepPerformance",
    message: "Analyzing performance..."
  },
  {
    id: "stepSEO",
    message: "Checking SEO..."
  },
  {
    id: "stepAccessibility",
    message: "Checking accessibility..."
  },
  {
    id: "stepReport",
    message: "Preparing final report..."
  }
];

function normalizeUrl(value) {
  let url = value.trim();

  if (!url) {
    throw new Error("Please enter a website URL.");
  }

  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Please enter a valid website URL.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }

  if (!parsedUrl.hostname.includes(".")) {
    throw new Error("Please enter a valid public website domain.");
  }

  return parsedUrl.href;
}

function showLoading(url) {
  loadingOverlay.classList.remove("hidden");
  loadingUrl.textContent = url;

  loadingProgress = 0;
  currentStep = 0;

  loadingProgressBar.style.width = "0%";
  loadingPercent.textContent = "0%";
  loadingStatus.textContent = "Initializing analysis engine...";

  loadingStages.forEach((stage) => {
    const element = document.getElementById(stage.id);

    element.classList.remove("active", "completed");

    const status = element.querySelector(".step-status");
    status.textContent = "WAITING";
  });

  activateStep(0);

  if (loadingTimer) {
    clearInterval(loadingTimer);
  }

  /*
    The backend currently does not provide actual Lighthouse
    progress events. This is an indicative loading animation.
    It stops at 88% until the actual API response arrives.
  */

  loadingTimer = setInterval(() => {
    if (loadingProgress < 88) {
      loadingProgress += Math.random() * 2.2 + 0.5;

      loadingProgress = Math.min(loadingProgress, 88);

      updateLoadingProgress(loadingProgress);
    }

    const nextStep = Math.min(
      Math.floor(loadingProgress / 19),
      loadingStages.length - 1
    );

    if (nextStep > currentStep) {
      completePreviousSteps(nextStep);
      currentStep = nextStep;
      activateStep(currentStep);
    }
  }, 700);
}

function updateLoadingProgress(progress) {
  const safeProgress = Math.min(Math.round(progress), 100);

  loadingProgressBar.style.width = safeProgress + "%";
  loadingPercent.textContent = safeProgress + "%";
}

function activateStep(index) {
  if (index >= loadingStages.length) {
    return;
  }

  const stage = loadingStages[index];
  const element = document.getElementById(stage.id);

  element.classList.add("active");

  const status = element.querySelector(".step-status");
  status.textContent = "IN PROGRESS";

  loadingStatus.textContent = stage.message;
}

function completePreviousSteps(index) {
  for (let i = 0; i < index; i++) {
    const stage = loadingStages[i];
    const element = document.getElementById(stage.id);

    element.classList.remove("active");
    element.classList.add("completed");

    const status = element.querySelector(".step-status");
    status.textContent = "DONE";
  }
}

function finishLoading() {
  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }

  loadingProgress = 100;

  updateLoadingProgress(100);

  loadingStatus.textContent = "Analysis completed successfully!";

  loadingStages.forEach((stage) => {
    const element = document.getElementById(stage.id);

    element.classList.remove("active");
    element.classList.add("completed");

    const status = element.querySelector(".step-status");
    status.textContent = "DONE";
  });

  setTimeout(() => {
    loadingOverlay.classList.add("hidden");
  }, 500);
}

function stopLoading() {
  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }

  loadingOverlay.classList.add("hidden");
}

function getScoreStatus(score) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return {
      label: "Unavailable",
      color: "#8d97aa"
    };
  }

  if (score >= 90) {
    return {
      label: "Excellent",
      color: "#38d9a9"
    };
  }

  if (score >= 50) {
    return {
      label: "Needs Improvement",
      color: "#f7c66b"
    };
  }

  return {
    label: "Poor",
    color: "#ff6b81"
  };
}

function updateMetric(category, score) {
  const scoreElement = document.getElementById(category + "Score");
  const statusElement = document.getElementById(category + "Status");
  const barElement = document.getElementById(category + "Bar");

  if (
    score === null ||
    score === undefined ||
    !Number.isFinite(Number(score))
  ) {
    scoreElement.textContent = "N/A";
    statusElement.textContent = "Unavailable";
    statusElement.style.color = "#8d97aa";
    barElement.style.width = "0%";
    barElement.style.background = "#596477";

    return;
  }

  const numericScore = Math.max(
    0,
    Math.min(100, Math.round(Number(score)))
  );

  const scoreStatus = getScoreStatus(numericScore);

  scoreElement.textContent = numericScore;
  statusElement.textContent = scoreStatus.label;
  statusElement.style.color = scoreStatus.color;

  barElement.style.width = numericScore + "%";
  barElement.style.background = scoreStatus.color;
}

function updateOverallScore(scores) {
  const availableScores = [
    scores.performance,
    scores.seo,
    scores.accessibility
  ].filter((score) => {
    return (
      score !== null &&
      score !== undefined &&
      Number.isFinite(Number(score))
    );
  });

  const healthScore = document.getElementById("healthScore");
  const healthMessage = document.getElementById("healthMessage");
  const healthCircle = document.getElementById("healthCircle");

  if (availableScores.length === 0) {
    healthScore.textContent = "N/A";
    healthMessage.textContent = "Score unavailable";

    healthCircle.style.background =
      "conic-gradient(#596477 0deg, #202a3b 0deg)";

    return;
  }

  const average =
    availableScores.reduce((total, score) => {
      return total + Number(score);
    }, 0) / availableScores.length;

  const roundedScore = Math.round(average);

  healthScore.textContent = roundedScore;

  const scoreStatus = getScoreStatus(roundedScore);

  healthMessage.textContent = scoreStatus.label;

  healthCircle.style.background =
    `conic-gradient(${scoreStatus.color} ${roundedScore * 3.6}deg, #202a3b 0deg)`;
}

function getAuditPriority(audit) {
  const score = audit.score;

  if (score === null || score === undefined) {
    return "info";
  }

  if (score <= 0) {
    return "critical";
  }

  if (score < 0.9) {
    return "warning";
  }

  return "good";
}

function getAuditExplanation(audit) {
  const title = (audit.title || "").toLowerCase();

  if (title.includes("image")) {
    return "Large or unoptimized images can make your website load slowly. Consider compressing images and using modern image formats such as WebP or AVIF.";
  }

  if (title.includes("render") || title.includes("blocking")) {
    return "Some files may be delaying the browser from displaying your page. Review these resources and consider loading non-critical files later.";
  }

  if (title.includes("javascript")) {
    return "JavaScript may be taking too much time to download or execute. Remove unused code and consider splitting large scripts into smaller parts.";
  }

  if (title.includes("contrast")) {
    return "Some text may be difficult to read because its color does not contrast enough with the background. Adjust the text or background color.";
  }

  if (title.includes("meta description")) {
    return "Search engines may not have a useful description of this page. Add a clear and relevant meta description to the page.";
  }

  if (title.includes("document title") || title.includes("title")) {
    return "A clear page title helps visitors and search engines understand the content. Add a descriptive title to your HTML document.";
  }

  if (title.includes("alt")) {
    return "Images may be missing alternative text. Add meaningful alt text to informative images so that screen readers can describe them.";
  }

  if (title.includes("viewport")) {
    return "Your page may not be configured properly for mobile screens. Add a responsive viewport meta tag.";
  }

  if (title.includes("https")) {
    return "Secure HTTPS connections help protect information exchanged between your website and visitors.";
  }

  return "Review this audit to understand what is affecting your website. Follow the recommendation and retest your website after making changes.";
}

function getAuditFix(audit) {
  const title = (audit.title || "").toLowerCase();

  if (title.includes("meta description")) {
    return `<meta name="description" content="Write a clear summary of your webpage here.">`;
  }

  if (title.includes("document title") || title.includes("title")) {
    return `<title>Your Page Name | Your Brand</title>`;
  }

  if (title.includes("viewport")) {
    return `<meta name="viewport" content="width=device-width, initial-scale=1.0">`;
  }

  if (title.includes("alt")) {
    return `<img src="image.webp" alt="Describe the image clearly">`;
  }

  if (title.includes("image")) {
    return "Compress images before uploading. Use WebP or AVIF where supported and resize images to the dimensions actually needed.";
  }

  if (title.includes("contrast")) {
    return "Choose text and background colors with sufficient contrast. Check the updated colors with an accessibility contrast checker.";
  }

  if (title.includes("javascript")) {
    return "Remove unused JavaScript and load non-critical scripts with defer where appropriate.";
  }

  return audit.description ||
    "Review the audit details and apply the recommended improvement.";
}

function createAuditElement(audit) {
  const priority = getAuditPriority(audit);

  const item = document.createElement("article");
  item.className = "audit-item";

  const top = document.createElement("div");
  top.className = "audit-item-top";

  const symbol = document.createElement("div");
  symbol.className = "audit-symbol " + priority;

  symbol.textContent =
    priority === "critical" ? "!" :
    priority === "warning" ? "!" :
    priority === "good" ? "✓" : "i";

  const content = document.createElement("div");
  content.style.flex = "1";

  const title = document.createElement("h3");
  title.className = "audit-title";
  title.textContent = audit.title || "Website audit finding";

  const description = document.createElement("p");
  description.className = "audit-description";
  description.textContent =
    audit.description || getAuditExplanation(audit);

  content.appendChild(title);
  content.appendChild(description);

  top.appendChild(symbol);
  top.appendChild(content);

  const meta = document.createElement("div");
  meta.className = "audit-meta";

  const priorityTag = document.createElement("span");
  priorityTag.className = "audit-tag " + priority;

  priorityTag.textContent =
    priority === "critical" ? "HIGH PRIORITY" :
    priority === "warning" ? "NEEDS ATTENTION" :
    priority === "good" ? "PASSED" : "INFORMATION";

  meta.appendChild(priorityTag);

  if (audit.displayValue) {
    const displayTag = document.createElement("span");
    displayTag.className = "audit-tag";
    displayTag.textContent = audit.displayValue;

    meta.appendChild(displayTag);
  }

  const details = document.createElement("details");
  details.className = "audit-details";

  const summary = document.createElement("summary");
  summary.textContent = "How to fix this issue";

  const fix = document.createElement("div");
  fix.className = "audit-fix";

  const fixHeading = document.createElement("strong");
  fixHeading.textContent = "Recommended solution: ";

  const fixText = document.createElement("span");
  fixText.textContent = getAuditFix(audit);

  fix.appendChild(fixHeading);
  fix.appendChild(fixText);

  details.appendChild(summary);
  details.appendChild(fix);

  item.appendChild(top);
  item.appendChild(meta);
  item.appendChild(details);

  return item;
}

function displayAuditResults(audits) {
  auditResults.innerHTML = "";

  if (!Array.isArray(audits) || audits.length === 0) {
    const empty = document.createElement("div");

    empty.className = "empty-audits";
    empty.textContent =
      "No failed audit findings were returned. This does not necessarily mean the website has no issues.";

    auditResults.appendChild(empty);

    issueCount.textContent = "0";

    return;
  }

  const failedAudits = audits.filter((audit) => {
    return audit.score === null || audit.score < 1;
  });

  issueCount.textContent = failedAudits.length;

  if (failedAudits.length === 0) {
    const empty = document.createElement("div");

    empty.className = "empty-audits";
    empty.textContent =
      "Great! No failed audit findings were returned for the selected categories.";

    auditResults.appendChild(empty);

    return;
  }

  failedAudits.forEach((audit) => {
    const auditElement = createAuditElement(audit);

    auditResults.appendChild(auditElement);
  });
}

function displayResults(data, url) {
  const scores = {
    performance: data.performance ?? null,
    seo: data.seo ?? null,
    accessibility: data.accessibility ?? null
  };

  updateMetric("performance", scores.performance);
  updateMetric("seo", scores.seo);
  updateMetric("accessibility", scores.accessibility);

  const securityScore = url.startsWith("https://") ? 100 : 0;

  updateMetric("security", securityScore);

  updateOverallScore(scores);

  document.getElementById("resultUrl").textContent =
    data.url || url;

  displayAuditResults(data.audits || []);

  resultsSection.classList.remove("hidden");
  errorSection.classList.add("hidden");

  resultsSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function analyzeWebsite(url) {
  currentUrl = url;

  resultsSection.classList.add("hidden");
  errorSection.classList.add("hidden");

  analyzeBtn.disabled = true;
  analyzeBtn.querySelector("span").textContent = "Analyzing...";

  showLoading(url);

  try {
    const response = await fetch(`${API_BASE_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: url
      })
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The analyzer returned an invalid response. Please check your backend server."
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error || "Website analysis failed."
      );
    }

    if (data.success === false) {
      throw new Error(
        data.error || "The analysis could not be completed."
      );
    }

    finishLoading();

    displayResults(data, url);

  } catch (error) {
    stopLoading();

    errorMessage.textContent =
      error.message ||
      "Unable to connect to the Health Checker analysis server.";

    errorSection.classList.remove("hidden");

    console.error("Health Checker error:", error);

  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.querySelector("span").textContent = "Analyze Website";
  }
}

analyzeForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const url = normalizeUrl(websiteUrlInput.value);

    websiteUrlInput.value = url;

    await analyzeWebsite(url);

  } catch (error) {
    errorMessage.textContent = error.message;

    errorSection.classList.remove("hidden");
    resultsSection.classList.add("hidden");
  }
});

reanalyzeBtn.addEventListener("click", () => {
  if (currentUrl) {
    analyzeWebsite(currentUrl);
  }
});

errorRetryBtn.addEventListener("click", () => {
  if (currentUrl) {
    analyzeWebsite(currentUrl);
  } else {
    analyzeForm.requestSubmit();
  }
});
