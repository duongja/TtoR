const refreshButton = document.querySelector("#refreshButton");
const autoRefreshToggle = document.querySelector("#autoRefreshToggle");
const minScoreInput = document.querySelector("#minScoreInput");
const statusFilter = document.querySelector("#statusFilter");

const elements = {
  healthStatus: document.querySelector("#healthStatus"),
  loginState: document.querySelector("#loginState"),
  lastPoll: document.querySelector("#lastPoll"),
  latestPostId: document.querySelector("#latestPostId"),
  signalCount: document.querySelector("#signalCount"),
  signalThresholdLabel: document.querySelector("#signalThresholdLabel"),
  analysisCount: document.querySelector("#analysisCount"),
  dexCount: document.querySelector("#dexCount"),
  dexStateLabel: document.querySelector("#dexStateLabel"),
  lastUpdated: document.querySelector("#lastUpdated"),
  latestPostLink: document.querySelector("#latestPostLink"),
  latestPostText: document.querySelector("#latestPostText"),
  latestCreatedAt: document.querySelector("#latestCreatedAt"),
  latestDetectedAt: document.querySelector("#latestDetectedAt"),
  latestAnalysis: document.querySelector("#latestAnalysis"),
  signalsState: document.querySelector("#signalsState"),
  dexState: document.querySelector("#dexState"),
  analysesState: document.querySelector("#analysesState"),
  signalsList: document.querySelector("#signalsList"),
  dexList: document.querySelector("#dexList"),
  analysesList: document.querySelector("#analysesList")
};

const sectionTabs = [...document.querySelectorAll(".section-tab")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const emptyTemplate = document.querySelector("#emptyTemplate");
let refreshTimer = null;
let isRefreshing = false;

function activateTab(panelId) {
  for (const tab of sectionTabs) {
    const isActive = tab.dataset.tabTarget === panelId;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of tabPanels) {
    const isActive = panel.id === panelId;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  }
}

function api(path) {
  return fetch(path, { cache: "no-store" }).then(async (response) => {
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error ?? `Request failed with ${response.status}`);
    }
    return body;
  });
}

function optionalApi(path, fallback) {
  return api(path).catch(() => fallback);
}

function formatTime(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatRelative(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (abs < 60) {
    return formatter.format(seconds, "second");
  }
  if (abs < 3600) {
    return formatter.format(Math.round(seconds / 60), "minute");
  }
  if (abs < 86400) {
    return formatter.format(Math.round(seconds / 3600), "hour");
  }
  return formatter.format(Math.round(seconds / 86400), "day");
}

function scoreClass(score) {
  if (score >= 80) {
    return "score hot";
  }
  if (score >= 55) {
    return "score warn";
  }
  return "score";
}

function setState(element, label, kind = "") {
  element.textContent = label;
  element.className = `state-pill ${kind}`.trim();
}

function renderEmpty(target, message = "No rows found") {
  const node = emptyTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("strong").textContent = message;
  target.replaceChildren(node);
}

function shortId(postId) {
  return postId ? `${postId.slice(0, 6)}...${postId.slice(-4)}` : "Unknown post";
}

function xPostUrl(postId) {
  return `https://x.com/Polymarket/status/${encodeURIComponent(postId)}`;
}

function renderNames(names) {
  if (!Array.isArray(names) || names.length === 0) {
    return '<span class="tag">No names</span>';
  }

  return names
    .slice(0, 5)
    .map((item) => {
      const ticker = item.ticker ? `$${escapeHtml(item.ticker)}` : "No ticker";
      return `<span class="tag">${escapeHtml(item.name)} ${ticker}</span>`;
    })
    .join("");
}

function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "n/a";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: number >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: number >= 1000 ? 0 : 2
  }).format(number);
}

function renderRiskFlags(flags) {
  if (!Array.isArray(flags) || flags.length === 0) {
    return '<span class="tag action">passed filters</span>';
  }

  return flags
    .slice(0, 5)
    .map((flag) => `<span class="tag ${String(flag).includes("low") ? "error" : ""}">${escapeHtml(String(flag).replaceAll("_", " "))}</span>`)
    .join("");
}

function renderPriorityReasons(candidate) {
  const reasons = Array.isArray(candidate.priorityReasons) ? candidate.priorityReasons : [];
  if (reasons.length === 0) {
    return "";
  }

  return reasons
    .slice(0, 4)
    .map((reason) => `<span class="tag priority">${escapeHtml(String(reason).replaceAll("_", " "))}</span>`)
    .join("");
}

function metricGain(current, previous) {
  const currentNumber = Number(current);
  const previousNumber = Number(previous);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber) || previousNumber <= 0) {
    return null;
  }

  return (currentNumber - previousNumber) / previousNumber;
}

function formatGain(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const formatted = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: Math.abs(value) >= 1 ? 0 : 1
  }).format(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function scoreFallbackPriority(candidate) {
  const reasons = [];
  let score = 0;

  if ((candidate.volume24hUsd ?? 0) >= 100_000) {
    reasons.push("strong_volume");
    score += 20;
  }
  if ((candidate.liquidityUsd ?? 0) >= 50_000) {
    reasons.push("strong_liquidity");
    score += 15;
  }
  if (candidate.pairCreatedAt) {
    const ageHours = (Date.now() - new Date(candidate.pairCreatedAt).getTime()) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours <= 24) {
      reasons.push("fresh_launch");
      score += 15;
    }
  }

  return {
    priorityScore: Math.min(100, score),
    priorityReasons: reasons
  };
}

function normalizeTerm(value) {
  return String(value ?? "")
    .replaceAll("$", "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function dexPairKey(pair) {
  return `${pair.chainId ?? "unknown"}:${pair.pairAddress ?? pair.url ?? ""}`;
}

function pairMatchesTerm(pair, term) {
  const normalized = normalizeTerm(term);
  const name = normalizeTerm(pair.baseToken?.name);
  const symbol = normalizeTerm(pair.baseToken?.symbol);
  return Boolean(normalized && (name.includes(normalized) || normalized.includes(name) || symbol === normalized));
}

function buildDexFallbackQueries(signals) {
  const queries = [];
  const seen = new Set();
  const maxSignals = 5;
  const maxQueriesPerSignal = 3;

  for (const signal of signals.slice(0, maxSignals)) {
    const terms = [
      ...(signal.searchTerms ?? []),
      ...(signal.possibleNames ?? []).flatMap((name) => [name.ticker, name.name]),
      ...(signal.entities ?? [])
    ];
    let signalQueryCount = 0;

    for (const term of terms) {
      const normalized = normalizeTerm(term);
      if (normalized.length < 2 || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      queries.push({
        postId: signal.postId,
        narrative: signal.narrative,
        whySignal: signal.whySignal,
        query: normalized
      });
      signalQueryCount += 1;
      if (signalQueryCount >= maxQueriesPerSignal) {
        break;
      }
    }
  }

  return queries;
}

function pairToDexCandidate(pair, source, query) {
  const liquidityUsd = Number(pair.liquidity?.usd ?? 0);
  const volume24hUsd = Number(pair.volume?.h24 ?? 0);
  const hasMatch = pairMatchesTerm(pair, query);
  const marketComponent = Math.min(35, Math.log10(Math.max(1, liquidityUsd + volume24hUsd)) * 7);
  const matchScore = Math.max(1, Math.min(100, Math.round((hasMatch ? 55 : 25) + marketComponent)));
  const riskFlags = [];

  if (liquidityUsd > 0 && liquidityUsd < 5000) {
    riskFlags.push("low_liquidity");
  }
  if (volume24hUsd > 0 && volume24hUsd < 1000) {
    riskFlags.push("low_volume");
  }
  if (!pair.info?.websites?.length && !pair.info?.socials?.length) {
    riskFlags.push("missing_socials");
  }

  return {
    postId: source.postId,
    chainId: pair.chainId ?? "unknown",
    dexId: pair.dexId ?? "unknown",
    pairAddress: pair.pairAddress ?? "",
    baseTokenAddress: pair.baseToken?.address ?? "",
    baseTokenName: pair.baseToken?.name ?? "Unknown token",
    baseTokenSymbol: pair.baseToken?.symbol ?? "",
    quoteTokenSymbol: pair.quoteToken?.symbol ?? null,
    url: pair.url ?? "#",
    priceUsd: Number(pair.priceUsd ?? 0),
    liquidityUsd,
    volume24hUsd,
    marketCap: Number(pair.marketCap ?? 0),
    fdv: Number(pair.fdv ?? 0),
    pairCreatedAt: pair.pairCreatedAt ? new Date(Number(pair.pairCreatedAt)).toISOString() : null,
    matchScore,
    riskFlags,
    matchedTerms: [query],
    narrative: source.narrative,
    whySignal: source.whySignal,
    lastCheckedAt: new Date().toISOString(),
    ...scoreFallbackPriority({
      liquidityUsd,
      volume24hUsd,
      pairCreatedAt: pair.pairCreatedAt ? new Date(Number(pair.pairCreatedAt)).toISOString() : null
    })
  };
}

async function discoverDexFromSignals(signals) {
  const queries = buildDexFallbackQueries(signals);
  const candidates = new Map();

  for (const source of queries) {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(source.query)}`;
    const response = await fetch(url, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      continue;
    }

    const payload = await response.json().catch(() => null);
    for (const pair of payload?.pairs ?? []) {
      if (!pair.chainId || !pair.pairAddress || !pair.url) {
        continue;
      }

      const candidate = pairToDexCandidate(pair, source, source.query);
      const existing = candidates.get(dexPairKey(pair));
      if (!existing || candidate.matchScore > existing.matchScore) {
        candidates.set(dexPairKey(pair), candidate);
      }
    }
  }

  return [...candidates.values()]
    .sort((left, right) => right.matchScore - left.matchScore || (right.liquidityUsd ?? 0) - (left.liquidityUsd ?? 0))
    .slice(0, 20);
}

function groupDexDiscoveriesByNews(candidates, signals) {
  const signalByPostId = new Map(signals.map((signal) => [signal.postId, signal]));
  const groups = new Map();

  for (const candidate of candidates) {
    const signal = signalByPostId.get(candidate.postId);
    const group = groups.get(candidate.postId) ?? {
      postId: candidate.postId,
      signalScore: signal?.signalScore ?? candidate.signalScore ?? null,
      title: signal?.possibleNames?.[0]?.name ?? signal?.narrative ?? candidate.narrative ?? shortId(candidate.postId),
      narrative: signal?.whySignal || signal?.narrative || candidate.whySignal || candidate.narrative || "Matched from a stored narrative signal.",
      candidates: []
    };

    group.candidates.push(candidate);
    groups.set(candidate.postId, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      candidates: group.candidates.sort(
        (left, right) =>
          (right.priorityScore ?? 0) - (left.priorityScore ?? 0) ||
          right.matchScore - left.matchScore ||
          (right.liquidityUsd ?? 0) - (left.liquidityUsd ?? 0)
      )
    }))
    .sort((left, right) => {
      const leftPriority = Math.max(...left.candidates.map((candidate) => candidate.priorityScore ?? 0));
      const rightPriority = Math.max(...right.candidates.map((candidate) => candidate.priorityScore ?? 0));
      return rightPriority - leftPriority || (right.signalScore ?? 0) - (left.signalScore ?? 0) || right.candidates.length - left.candidates.length;
    });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderHealth(health) {
  elements.healthStatus.textContent = health.status ?? "Unknown";
  elements.loginState.textContent = `Login ${health.loginState ?? "unknown"}`;
  elements.lastPoll.textContent = formatRelative(health.lastSuccessfulPollAt);
  elements.latestPostId.textContent = health.latestPostId ? `Latest ${shortId(health.latestPostId)}` : "No latest post";
}

function renderLatestPost(post, analysis) {
  elements.latestPostText.textContent = post.text ?? "No latest post text available.";
  elements.latestPostLink.href = xPostUrl(post.postId);
  elements.latestPostLink.hidden = !post.postId;
  elements.latestCreatedAt.textContent = `Created: ${formatTime(post.createdAt)}`;
  elements.latestDetectedAt.textContent = `Detected: ${formatTime(post.detectedAt)}`;

  if (!analysis) {
    elements.latestAnalysis.textContent = "No AI analysis found for the latest post yet.";
    return;
  }

  if (analysis.status === "error") {
    elements.latestAnalysis.textContent = `AI error: ${analysis.errorMessage ?? "Unknown error"}`;
    return;
  }

  elements.latestAnalysis.textContent =
    `AI: score ${analysis.signalScore}, ${analysis.recommendedAction}. ${analysis.whySignal || analysis.narrative || "No rationale returned."}`;
}

function renderSignals(signals) {
  elements.signalCount.textContent = String(signals.length);
  elements.signalThresholdLabel.textContent = `Score >= ${minScoreInput.value || 0}`;

  if (signals.length === 0) {
    setState(elements.signalsState, "Empty");
    renderEmpty(elements.signalsList, "No positive signals at this threshold");
    return;
  }

  setState(elements.signalsState, `${signals.length} rows`, "good");
  elements.signalsList.replaceChildren(
    ...signals.map((signal) => {
      const card = document.createElement("article");
      card.className = "signal-card";
      const title = signal.possibleNames?.[0]?.name ?? signal.narrative ?? "Signal candidate";
      card.innerHTML = `
        <div class="${scoreClass(signal.signalScore)}">${escapeHtml(signal.signalScore)}</div>
        <div>
          <div class="row-heading">
            <h3>${escapeHtml(title)}</h3>
            <a class="text-link" href="${xPostUrl(signal.postId)}" target="_blank" rel="noreferrer">Open on X</a>
          </div>
          <p>${escapeHtml(signal.whySignal || signal.narrative || "No rationale returned.")}</p>
          <div class="tag-row">
            <span class="tag action">${escapeHtml(signal.recommendedAction)}</span>
            <span class="tag">${escapeHtml(signal.confidence)} confidence</span>
            <span class="tag">${escapeHtml(signal.urgency)} urgency</span>
            ${renderNames(signal.possibleNames)}
          </div>
        </div>
      `;
      return card;
    })
  );
}

function renderDexCoinCard(candidate) {
  const card = document.createElement("article");
  const highPriority = (candidate.priorityScore ?? 0) >= 50;
  card.className = highPriority ? "coin-card high-priority" : "coin-card";
  const symbol = candidate.baseTokenSymbol ? `$${candidate.baseTokenSymbol}` : "";
  const title = `${candidate.baseTokenName ?? "Unknown token"} ${symbol}`.trim();
  const matched = Array.isArray(candidate.matchedTerms) && candidate.matchedTerms[0]
    ? `<span class="tag">matched ${escapeHtml(candidate.matchedTerms[0])}</span>`
    : "";
  const priceGain = formatGain(metricGain(candidate.priceUsd, candidate.previousPriceUsd));
  const discoveryGain = formatGain(metricGain(candidate.priceUsd, candidate.firstPriceUsd));

  card.innerHTML = `
    <div class="coin-card-top">
      <div>
        <h4>${escapeHtml(title)}</h4>
        <span>${escapeHtml(candidate.chainId)} / ${escapeHtml(candidate.dexId)}</span>
      </div>
      <div class="${scoreClass(candidate.matchScore)}">${escapeHtml(candidate.matchScore)}</div>
    </div>
    <div class="tag-row compact">
      ${highPriority ? `<span class="tag priority">high priority ${escapeHtml(candidate.priorityScore ?? 0)}</span>` : ""}
      <span class="tag">liq ${escapeHtml(formatUsd(candidate.liquidityUsd))}</span>
      <span class="tag">24h ${escapeHtml(formatUsd(candidate.volume24hUsd))}</span>
      <span class="tag">fdv ${escapeHtml(formatUsd(candidate.fdv))}</span>
      ${priceGain ? `<span class="tag action">price ${escapeHtml(priceGain)} check</span>` : ""}
      ${discoveryGain ? `<span class="tag action">price ${escapeHtml(discoveryGain)} discovery</span>` : ""}
      ${candidate.lastCheckedAt ? `<span class="tag">checked ${escapeHtml(formatRelative(candidate.lastCheckedAt))}</span>` : ""}
      ${matched}
      ${renderPriorityReasons(candidate)}
      ${renderRiskFlags(candidate.riskFlags)}
    </div>
    <a class="text-link" href="${escapeHtml(candidate.url)}" target="_blank" rel="noreferrer">Open DexScreener</a>
  `;
  return card;
}

function renderDexDiscoveries(candidates, signals) {
  elements.dexCount.textContent = String(candidates.length);
  const groups = groupDexDiscoveriesByNews(candidates, signals);
  const highPriorityCount = candidates.filter((candidate) => (candidate.priorityScore ?? 0) >= 50).length;
  elements.dexStateLabel.textContent = groups.length
    ? `${groups.length} news groups${highPriorityCount ? `, ${highPriorityCount} priority` : ""}`
    : "No token matches";

  if (candidates.length === 0) {
    setState(elements.dexState, "Empty");
    renderEmpty(elements.dexList, "No DEX token matches yet");
    return;
  }

  setState(elements.dexState, highPriorityCount ? `${highPriorityCount} priority` : `${groups.length} news`, "good");
  elements.dexList.replaceChildren(
    ...groups.map((group) => {
      const section = document.createElement("article");
      section.className = "dex-news-group";
      const groupPriorityCount = group.candidates.filter((candidate) => (candidate.priorityScore ?? 0) >= 50).length;
      section.innerHTML = `
        <div class="dex-news-heading">
          <div>
            <div class="tag-row compact">
              <span class="tag action">${escapeHtml(group.candidates.length)} possible coins</span>
              ${groupPriorityCount ? `<span class="tag priority">${escapeHtml(groupPriorityCount)} high priority</span>` : ""}
              ${group.signalScore === null ? "" : `<span class="tag">signal ${escapeHtml(group.signalScore)}</span>`}
            </div>
            <h3>${escapeHtml(group.title)}</h3>
            <p>${escapeHtml(group.narrative)}</p>
          </div>
          <a class="text-link" href="${xPostUrl(group.postId)}" target="_blank" rel="noreferrer">Open news</a>
        </div>
        <div class="coin-grid"></div>
      `;
      const grid = section.querySelector(".coin-grid");
      grid.replaceChildren(...group.candidates.slice(0, 6).map(renderDexCoinCard));
      return section;
    })
  );
}

async function loadDexDiscoveries(signals) {
  const [stored, fallback] = await Promise.all([
    api("/api/dex-discoveries?min_score=0&limit=100").catch(() => []),
    discoverDexFromSignals(signals)
  ]);
  const candidates = new Map();

  for (const candidate of Array.isArray(stored) ? stored : []) {
    candidates.set(`${candidate.chainId ?? "unknown"}:${candidate.pairAddress ?? candidate.url ?? ""}`, candidate);
  }

  for (const candidate of fallback) {
    const key = `${candidate.chainId ?? "unknown"}:${candidate.pairAddress ?? candidate.url ?? ""}`;
    if (!candidates.has(key)) {
      candidates.set(key, candidate);
    }
  }

  return [...candidates.values()]
    .sort(
      (left, right) =>
        (right.priorityScore ?? 0) - (left.priorityScore ?? 0) ||
        right.matchScore - left.matchScore ||
        (right.liquidityUsd ?? 0) - (left.liquidityUsd ?? 0)
    )
    .slice(0, 100);
}

function renderAnalyses(analyses) {
  elements.analysisCount.textContent = String(analyses.length);

  if (analyses.length === 0) {
    setState(elements.analysesState, "Empty");
    renderEmpty(elements.analysesList, "No analyses found");
    return;
  }

  setState(elements.analysesState, `${analyses.length} rows`, "good");
  elements.analysesList.replaceChildren(
    ...analyses.map((analysis) => {
      const row = document.createElement("article");
      row.className = "analysis-row";
      const isError = analysis.status === "error";
      const summary = isError
        ? analysis.errorMessage ?? "AI analysis failed"
        : analysis.whySignal || analysis.narrative || "No rationale returned.";
      row.innerHTML = `
        <div>
          <div class="row-heading">
            <h3>${escapeHtml(shortId(analysis.postId))}</h3>
            <a class="text-link" href="${xPostUrl(analysis.postId)}" target="_blank" rel="noreferrer">Open on X</a>
          </div>
          <p>${escapeHtml(summary)}</p>
          <div class="tag-row">
            <span class="tag ${isError ? "error" : "action"}">${escapeHtml(analysis.status)}</span>
            <span class="tag">${escapeHtml(analysis.recommendedAction ?? "none")}</span>
            <span class="tag">${formatTime(analysis.createdAt)}</span>
            ${renderNames(analysis.possibleNames)}
          </div>
        </div>
        <div class="${scoreClass(analysis.signalScore ?? 0)}">${escapeHtml(analysis.signalScore ?? 0)}</div>
      `;
      return row;
    })
  );
}

async function refresh() {
  if (isRefreshing) {
    return;
  }

  isRefreshing = true;
  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing";
  setState(elements.signalsState, "Loading");
  setState(elements.dexState, "Loading");
  setState(elements.analysesState, "Loading");

  try {
    const minScore = Math.max(0, Math.min(100, Number.parseInt(minScoreInput.value, 10) || 0));
    minScoreInput.value = String(minScore);
    const status = statusFilter.value ? `&status=${encodeURIComponent(statusFilter.value)}` : "";

    const [health, latestPost, signals, analyses] = await Promise.all([
      api("/api/health"),
      api("/api/posts/latest"),
      api(`/api/meme-signals?min_score=${minScore}&limit=20`),
      api(`/api/meme-analyses?limit=25${status}`)
    ]);
    const dexDiscoveries = await loadDexDiscoveries(signals);

    let latestAnalysis = null;
    if (latestPost?.postId) {
      latestAnalysis = await api(`/api/posts/${encodeURIComponent(latestPost.postId)}/meme-analysis`).catch(() => null);
    }

    renderHealth(health);
    renderLatestPost(latestPost, latestAnalysis);
    renderSignals(signals);
    renderDexDiscoveries(dexDiscoveries, signals);
    renderAnalyses(analyses);
    elements.lastUpdated.textContent = `Updated ${formatRelative(new Date().toISOString())}`;
  } catch (error) {
    setState(elements.signalsState, "Error", "bad");
    setState(elements.dexState, "Error", "bad");
    setState(elements.analysesState, "Error", "bad");
    renderEmpty(elements.signalsList, error.message);
    renderEmpty(elements.dexList, error.message);
    renderEmpty(elements.analysesList, error.message);
  } finally {
    isRefreshing = false;
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh";
  }
}

function scheduleAutoRefresh() {
  window.clearInterval(refreshTimer);
  if (autoRefreshToggle.checked) {
    refreshTimer = window.setInterval(refresh, 30_000);
  }
}

refreshButton.addEventListener("click", refresh);
autoRefreshToggle.addEventListener("change", scheduleAutoRefresh);
minScoreInput.addEventListener("change", refresh);
statusFilter.addEventListener("change", refresh);
for (const tab of sectionTabs) {
  tab.addEventListener("click", () => activateTab(tab.dataset.tabTarget));
}

scheduleAutoRefresh();
void refresh();
