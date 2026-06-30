import "./styles.css";
import { AgencyWorldApp, type AgentWorldMarker, type AppViewState } from "./render/AgencyWorldApp";
import { DEFAULT_FLAT_WORLD_OPTIONS } from "./world/FlatWorldGenerator";
import type { AgentSummary, SemanticObjectState, SimAgent } from "./agents/AgentSimulation";

const canvas = document.querySelector<HTMLCanvasElement>("#world");
const walletAddressInput = document.querySelector<HTMLInputElement>("#wallet-address");
const connectWallet = document.querySelector<HTMLButtonElement>("#connect-wallet");
const mockPurchase = document.querySelector<HTMLButtonElement>("#mock-purchase");
const spawnAgent = document.querySelector<HTMLButtonElement>("#spawn-agent");
const spawnAgentEmpty = document.querySelector<HTMLButtonElement>("#spawn-agent-empty");
const previousAgent = document.querySelector<HTMLButtonElement>("#previous-agent");
const nextAgent = document.querySelector<HTMLButtonElement>("#next-agent");
const cameraMode = document.querySelector<HTMLButtonElement>("#camera-mode");
const worldTitle = document.querySelector<HTMLElement>("#world-title");
const worldStats = document.querySelector<HTMLElement>("#world-stats");
const agentCount = document.querySelector<HTMLElement>("#agent-count");
const cityPulse = document.querySelector<HTMLElement>("#city-pulse");
const agentList = document.querySelector<HTMLElement>("#agent-list");
const selectedAgent = document.querySelector<HTMLElement>("#selected-agent");
const eventList = document.querySelector<HTMLElement>("#event-list");
const diagnostics = document.querySelector<HTMLElement>("#diagnostics");
const emptyState = document.querySelector<HTMLElement>("#empty-state");
const prompt = document.querySelector<HTMLElement>("#click-prompt");
const agentWorldLabels = document.querySelector<HTMLElement>("#agent-world-labels");

if (
  !canvas ||
  !walletAddressInput ||
  !connectWallet ||
  !mockPurchase ||
  !spawnAgent ||
  !spawnAgentEmpty ||
  !previousAgent ||
  !nextAgent ||
  !cameraMode ||
  !worldTitle ||
  !worldStats ||
  !agentCount ||
  !cityPulse ||
  !agentList ||
  !selectedAgent ||
  !eventList ||
  !diagnostics ||
  !emptyState ||
  !prompt ||
  !agentWorldLabels
) {
  throw new Error("Agency DOM shell is missing required elements.");
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const clockLabel = (minutes: number) => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour24 >= 12 ? "p" : "a";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute.toString().padStart(2, "0")}${suffix}`;
};
const walletLabel = (wallet: string) => (wallet.length > 14 ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : wallet);
const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const memoryKindLabel = (kind: SimAgent["memories"][number]["kind"]) =>
  ({ observation: "Seen", event: "Event", plan: "Plan", reflection: "Thought" })[kind];

const apiBaseUrl = (import.meta.env.VITE_AGENCY_API_URL as string | undefined) ?? "http://127.0.0.1:8787";
const adminToken = (import.meta.env.VITE_AGENCY_ADMIN_TOKEN as string | undefined) ?? "agency-dev-admin";
let walletSessionToken = localStorage.getItem("agency.walletSession");
const apiSpawnedKeys = new Set<string>();

type ApiAgentView = {
  id: string;
  name: string;
  walletLabel: string;
  publicProfile: {
    renderSeedInput?: {
      chainId?: string;
      walletAddress: string;
      tokenMint?: string;
      txHash?: string;
      logIndex?: number;
      slot?: number;
      purchaseOrdinal?: number;
      seasonId?: string;
      publicGenesisSalt?: string;
    };
  };
  ownerPrivate?: {
    walletAddress?: string;
    purchase?: {
      chainId?: string;
      walletAddress: string;
      tokenMint?: string;
      txSignature?: string;
      logIndex?: number;
      slot?: number;
    };
  };
};

const apiHeaders = (extra: Record<string, string> = {}) => ({
  "content-type": "application/json",
  ...(walletSessionToken ? { authorization: `Bearer ${walletSessionToken}` } : {}),
  ...extra
});

const fetchJson = async <T>(path: string, init: RequestInit = {}) => {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
};

const spawnApiAgentIntoViewer = (agent: ApiAgentView) => {
  if (apiSpawnedKeys.has(agent.id)) return null;
  const privatePurchase = agent.ownerPrivate?.purchase;
  const publicSeed = agent.publicProfile.renderSeedInput;
  const seedInput = privatePurchase
    ? {
        chainId: privatePurchase.chainId,
        walletAddress: privatePurchase.walletAddress,
        tokenMint: privatePurchase.tokenMint,
        txHash: privatePurchase.txSignature,
        logIndex: privatePurchase.logIndex,
        slot: privatePurchase.slot,
        seasonId: "genesis",
        publicGenesisSalt: "agency-owner-render"
      }
    : publicSeed;
  if (!seedInput) return null;
  apiSpawnedKeys.add(agent.id);
  return app.spawnAgentFromSeed(seedInput);
};

const renderMeter = (label: string, value: number, tone: "good" | "warn" | "danger" = "good") => `
  <div class="meter ${tone}">
    <div>
      <span>${label}</span>
      <b>${clamp(value)}</b>
    </div>
    <i style="--value: ${clamp(value)}%"></i>
  </div>
`;

const renderRoutinePill = (label: string, done: boolean) => `<span class="${done ? "done" : ""}">${label}</span>`;

const renderStatusEffects = (agent: SimAgent) => {
  const effects = agent.statusEffects.length > 0 ? agent.statusEffects : [{ id: "stable", label: "Stable", detail: "no urgent pressure", tone: "neutral" }];
  return `
    <div class="status-strip">
      ${effects
        .map(
          (effect) => `
            <span class="status-chip ${escapeHtml(effect.tone)}">
              <b>${escapeHtml(effect.label)}</b>
              <small>${escapeHtml(effect.detail)}</small>
            </span>
          `
        )
        .join("")}
    </div>
  `;
};

const renderMoodlets = (agent: SimAgent) => {
  if (agent.moodlets.length === 0) return "";
  return `
    <section class="moodlet-card" aria-label="Moodlets">
      <div class="moodlet-heading">
        <span>Moodlets</span>
        <b>${agent.moodlets.length}</b>
      </div>
      <div class="moodlet-list">
        ${agent.moodlets
          .slice(0, 5)
          .map(
            (moodlet) => `
              <span class="moodlet ${escapeHtml(moodlet.tone)}">
                <b>${escapeHtml(moodlet.label)}</b>
                <small>${escapeHtml(moodlet.detail)}</small>
                <i>${Math.round(moodlet.intensity)}/10</i>
              </span>
            `
          )
          .join("")}
      </div>
    </section>
  `;
};

const renderWantsAndFears = (agent: SimAgent) => {
  if (agent.wants.length === 0) return "";
  const active = agent.wants.filter((want) => want.status === "active").length;
  return `
    <section class="wants-card" aria-label="Wants and fears">
      <div class="wants-heading">
        <span>Wants & Fears</span>
        <b>${active} active</b>
      </div>
      <div class="wants-list">
        ${agent.wants
          .slice(0, 5)
          .map(
            (want) => `
              <span class="want-chip ${escapeHtml(want.kind)} ${escapeHtml(want.tone)} ${escapeHtml(want.status)}">
                <b>${escapeHtml(want.kind === "fear" ? "Fear" : "Want")}: ${escapeHtml(want.label)}</b>
                <small>${escapeHtml(want.detail)}</small>
                <i><em style="--value: ${clamp(want.progress)}%"></em></i>
                <strong>${escapeHtml(titleCase(want.status))} / ${Math.round(want.intensity)}</strong>
              </span>
            `
          )
          .join("")}
      </div>
    </section>
  `;
};

const pulseToneClass = (tone: AgentSummary["cityPulse"]["tone"]) => (tone === "bad" ? "bad" : tone === "warn" ? "warn" : tone === "good" ? "good" : "neutral");

const renderCivicNotices = (notices: AgentSummary["civicNotices"]) => {
  const active = notices.slice(0, 3);
  if (active.length === 0) return "";
  return `
    <div class="city-notices" aria-label="Town notices">
      ${active
        .map(
          (notice) => `
            <span class="city-notice ${escapeHtml(notice.tone)}">
              <b>${escapeHtml(notice.headline)}</b>
              <small>${escapeHtml(notice.detail)}</small>
              <em>${escapeHtml(titleCase(notice.kind))} / heard by ${notice.acknowledgedBy.length}</em>
            </span>
          `
        )
        .join("")}
    </div>
  `;
};

const renderWeather = (weather: AgentSummary["weather"]) => `
  <div class="city-weather ${escapeHtml(weather.tone)}" aria-label="District weather">
    <span>
      <b>${escapeHtml(weather.label)}</b>
      <small>${weather.temperature}F / visibility ${Math.round(weather.visibility * 100)}%</small>
    </span>
    <em>${escapeHtml(weather.detail)}</em>
  </div>
`;

const renderCityPulse = (pulse: AgentSummary["cityPulse"], notices: AgentSummary["civicNotices"], weather: AgentSummary["weather"]) => {
  const flags =
    pulse.flags.length > 0
      ? pulse.flags
          .map(
            (flag) => `
              <span class="city-pulse-flag ${escapeHtml(flag.tone)}">
                <b>${escapeHtml(flag.label)}</b>
                <small>${escapeHtml(flag.detail)}</small>
              </span>
            `
          )
          .join("")
      : `<span class="city-pulse-flag good"><b>Stable</b><small>No major pressure</small></span>`;
  const orders =
    pulse.workOrders.length > 0
      ? pulse.workOrders
          .slice(0, 3)
          .map(
            (order) => `
              <span class="city-work-order ${escapeHtml(order.tone)}">
                <b>${escapeHtml(order.label)}</b>
                <small>${escapeHtml(order.detail)}</small>
                <em>${order.score} / ${order.requiredJobs.map((job) => titleCase(job)).join(", ")}</em>
              </span>
            `
          )
          .join("")
      : "";

  return `
    <section class="city-pulse-card ${pulseToneClass(pulse.tone)}" aria-label="City pulse">
      <div class="city-pulse-heading">
        <span>City Pulse</span>
        <b>${pulse.overall}</b>
      </div>
      <p>${escapeHtml(pulse.headline)}</p>
      ${renderWeather(weather)}
      <div class="city-pulse-metrics">
        ${pulse.metrics
          .map(
            (metric) => `
              <span class="${pulseToneClass(metric.tone)}" title="${escapeHtml(metric.detail)}">
                <b>${escapeHtml(metric.label)}</b>
                <i style="--value: ${clamp(metric.value)}%"></i>
                <small>${metric.value}</small>
              </span>
            `
          )
          .join("")}
      </div>
      <div class="city-pulse-flags">${flags}</div>
      ${orders ? `<div class="city-work-orders">${orders}</div>` : ""}
      ${renderCivicNotices(notices)}
    </section>
  `;
};

const renderLifeProfile = (agent: SimAgent) => `
  <div class="life-profile">
    <span>${escapeHtml(agent.lifeProfile.archetype)}</span>
    <b>${escapeHtml(agent.lifeProfile.motive)}</b>
    <small>Habit: ${escapeHtml(agent.lifeProfile.habit)}</small>
    <small>Worry: ${escapeHtml(agent.lifeProfile.worry)}</small>
  </div>
`;

const driveLabels: Record<keyof SimAgent["values"], string> = {
  security: "Security",
  belonging: "Belonging",
  mastery: "Mastery",
  care: "Care",
  comfort: "Comfort",
  autonomy: "Autonomy"
};

const renderPersonalDrive = (agent: SimAgent) => {
  const drive = agent.activeDrive;
  const values = Object.entries(agent.values)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4) as Array<[keyof SimAgent["values"], number]>;
  return `
    <section class="drive-card ${escapeHtml(drive.tone)}" aria-label="Personal drive">
      <div class="drive-heading">
        <span>Personal Drive</span>
        <b>${escapeHtml(drive.label)}</b>
      </div>
      <p>${escapeHtml(drive.detail)}</p>
      <div class="drive-pressure">
        <span>Pull ${drive.pressure}</span>
        <b>Value ${drive.value}</b>
        <i><em style="--value: ${clamp(drive.pressure)}%"></em></i>
      </div>
      <div class="drive-values">
        ${values
          .map(
            ([key, value]) => `
              <span class="${key === drive.id ? "active" : ""}">
                <b>${escapeHtml(driveLabels[key])}</b>
                <small>${value}</small>
              </span>
            `
          )
          .join("")}
      </div>
    </section>
  `;
};

const renderLifePriority = (agent: SimAgent) => `
  <section class="priority-card ${escapeHtml(agent.lifePriority.tone)}" aria-label="Current priority">
    <span>Current Priority</span>
    <b>${escapeHtml(agent.lifePriority.label)}</b>
    <small>${escapeHtml(agent.lifePriority.detail)}</small>
  </section>
`;

const renderActiveIntention = (agent: SimAgent) => {
  const intention = agent.activeIntention;
  const actions = intention.actions.slice(0, 4).map((action) => escapeHtml(titleCase(action))).join(" / ");
  return `
    <section class="intention-card ${escapeHtml(intention.tone)}" aria-label="Active intention">
      <div class="intention-heading">
        <span>${escapeHtml(titleCase(intention.horizon))} Intention</span>
        <b>${escapeHtml(intention.label)}</b>
      </div>
      <p>${escapeHtml(intention.detail)}</p>
      <small>${escapeHtml(intention.reason)}</small>
      <div class="intention-bars">
        <span>
          <b>${Math.round(intention.urgency)}</b>
          <small>Urgency</small>
          <i><em style="--value: ${clamp(intention.urgency)}%"></em></i>
        </span>
        <span>
          <b>${Math.round(intention.confidence)}</b>
          <small>Confidence</small>
          <i><em style="--value: ${clamp(intention.confidence)}%"></em></i>
        </span>
      </div>
      <em>${actions}</em>
    </section>
  `;
};

const renderDecisionRead = (agent: SimAgent) => {
  const read = agent.decisionRead;
  const options = read.options.slice(0, 3);
  const factorList = read.factors.slice(0, 4);
  return `
    <section class="decision-read-card ${escapeHtml(options.find((option) => option.selected)?.tone ?? "neutral")}" aria-label="Decision read">
      <div class="decision-read-heading">
        <span>Decision Read</span>
        <b>${escapeHtml(read.selectedLabel)}</b>
      </div>
      <p>${escapeHtml(read.reason)}</p>
      <div class="decision-read-meta">
        <span>${escapeHtml(titleCase(read.style))}</span>
        <span>Urgency ${Math.round(read.urgency)}</span>
        <span>Confidence ${Math.round(read.confidence)}</span>
      </div>
      ${
        factorList.length > 0
          ? `<div class="decision-factors">${factorList.map((factor) => `<em>${escapeHtml(factor)}</em>`).join("")}</div>`
          : ""
      }
      ${
        options.length > 0
          ? `<ol>
              ${options
                .map(
                  (option) => `
                    <li class="${escapeHtml(option.tone)} ${option.selected ? "selected" : ""} ${option.reachable ? "reachable" : "blocked"}">
                      <strong>${escapeHtml(option.label)}</strong>
                      <span>${escapeHtml(option.intentLabel)} / ${escapeHtml(option.location)}</span>
                      <small>score ${option.utility} / fit ${option.choiceScore} / ${option.reachable ? `${option.routeSteps} route` : "blocked"}</small>
                    </li>
                  `
                )
                .join("")}
            </ol>`
          : `<small>No semantic options are available yet.</small>`
      }
    </section>
  `;
};

const renderAspiration = (agent: SimAgent) => {
  const aspiration = agent.aspiration;
  const recent = aspiration.history.slice(0, 2);
  return `
    <section class="aspiration-card ${escapeHtml(aspiration.tone)}" aria-label="Life aspiration">
      <div class="aspiration-heading">
        <span>Life Direction</span>
        <b>Lv ${aspiration.level} / ${escapeHtml(aspiration.label)}</b>
      </div>
      <p>${escapeHtml(aspiration.detail)}</p>
      <div class="aspiration-bars">
        <span>
          <b>${Math.round(aspiration.progress)}%</b>
          <small>${escapeHtml(aspiration.milestone)}</small>
          <i><em style="--value: ${clamp(aspiration.progress)}%"></em></i>
        </span>
        <span class="${aspiration.pressure >= 70 ? "bad" : aspiration.pressure >= 52 ? "warn" : "neutral"}">
          <b>${Math.round(aspiration.pressure)}</b>
          <small>Pressure</small>
          <i><em style="--value: ${clamp(aspiration.pressure)}%"></em></i>
        </span>
        <span class="${aspiration.dailyProgress > 0 ? "good" : "neutral"}">
          <b>${aspiration.dailyProgress}</b>
          <small>Today</small>
          <i><em style="--value: ${clamp(aspiration.dailyProgress * 8)}%"></em></i>
        </span>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No progress logged yet.</small>`
      }
    </section>
  `;
};

const renderCareer = (agent: SimAgent) => {
  const career = agent.career;
  const xpProgress = career.xpToNext > 0 ? (career.xp / career.xpToNext) * 100 : 100;
  const burnoutTone = career.burnout >= 72 ? "bad" : career.burnout >= 52 ? "warn" : "good";
  const performanceTone = career.performance >= 72 ? "good" : career.performance < 42 ? "bad" : "neutral";
  const recent = career.recent.slice(0, 2);
  return `
    <section class="career-card ${burnoutTone === "bad" ? "bad" : performanceTone === "good" ? "good" : "neutral"}" aria-label="Career">
      <div class="career-heading">
        <span>Career</span>
        <b>Lv ${career.level} / ${escapeHtml(career.title)}</b>
      </div>
      <div class="career-grid">
        <span class="good"><b>${career.wage}</b><small>Wage</small></span>
        <span class="${performanceTone}"><b>${career.performance}</b><small>Performance</small></span>
        <span class="${career.satisfaction < 36 ? "warn" : "good"}"><b>${career.satisfaction}</b><small>Satisfaction</small></span>
        <span class="${burnoutTone}"><b>${career.burnout}</b><small>Burnout</small></span>
      </div>
      <div class="career-xp">
        <span>${career.xp}/${career.xpToNext} XP</span>
        <b>${career.attendanceStreak} shift streak / ${career.missedShifts} missed</b>
        <i><em style="--value: ${clamp(xpProgress)}%"></em></i>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No career history yet.</small>`
      }
    </section>
  `;
};

const renderCivicService = (agent: SimAgent) => {
  const civic = agent.civic;
  const tone = civic.serviceImpactToday >= 12 || civic.serviceReputation >= 72 ? "good" : "neutral";
  const recent = civic.recent.slice(0, 2);
  return `
    <section class="civic-service-card ${tone}" aria-label="Public service">
      <div class="civic-service-heading">
        <span>Public Service</span>
        <b>${civic.lastService ? escapeHtml(civic.lastService) : `${civic.serviceReputation} service rep`}</b>
      </div>
      <div class="civic-service-grid">
        <span><b>${civic.serviceReputation}</b><small>Rep</small></span>
        <span><b>${civic.serviceImpactToday}</b><small>Today</small></span>
        <span><b>${civic.demandResolvedToday}</b><small>Demand</small></span>
        <span><b>${civic.pressureRelievedToday}</b><small>Pressure</small></span>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No service history yet.</small>`
      }
    </section>
  `;
};

const renderSkills = (agent: SimAgent) => {
  const skills = Object.values(agent.skills)
    .sort((a, b) => b.level - a.level || b.aptitude - a.aptitude)
    .slice(0, 6);
  return `
    <section class="skills-card" aria-label="Skills">
      <div class="skills-heading">
        <span>Life Skills</span>
        <b>${escapeHtml(skills[0]?.label ?? "Learning")}</b>
      </div>
      <div class="skills-grid">
        ${skills
          .map((skill) => {
            const xpProgress = skill.xpToNext > 0 ? (skill.xp / skill.xpToNext) * 100 : 100;
            const tone = skill.level >= 4 ? "good" : skill.aptitude >= 70 ? "warn" : "neutral";
            return `
              <span class="${tone}">
                <b>${escapeHtml(skill.label)}</b>
                <small>Lv ${skill.level} / Apt ${skill.aptitude}</small>
                <i><em style="--value: ${clamp(xpProgress)}%"></em></i>
              </span>
            `;
          })
          .join("")}
      </div>
      <ol>
        ${skills
          .slice(0, 2)
          .map((skill) => `<li>${escapeHtml(skill.recent[0] ?? `${skill.label} has not changed yet.`)}</li>`)
          .join("")}
      </ol>
    </section>
  `;
};

const renderHousehold = (agent: SimAgent) => {
  const home = agent.household;
  const pantryTone = home.pantry <= 0 ? "bad" : home.pantry <= 1 ? "warn" : "good";
  const toiletriesTone = home.toiletries <= 0 ? "bad" : home.toiletries <= 1 ? "warn" : "good";
  const cleaningTone = home.cleaningSupplies <= 0 ? "bad" : home.cleaningSupplies <= 1 ? "warn" : "good";
  const clutterTone = home.clutter >= 76 ? "bad" : home.clutter >= 58 ? "warn" : "good";
  const laundryTone = home.laundry >= 76 ? "bad" : home.laundry >= 58 ? "warn" : "good";
  const sleepTone = home.sleepQuality < 42 ? "bad" : home.sleepQuality < 64 ? "warn" : "good";
  const recent = home.recent.slice(0, 2);
  return `
    <section class="household-card ${
      pantryTone === "bad" || toiletriesTone === "bad" || cleaningTone === "bad" || clutterTone === "bad" || laundryTone === "bad" || sleepTone === "bad" ? "bad" : "neutral"
    }" aria-label="Household">
      <div class="household-heading">
        <span>Household</span>
        <b>${escapeHtml(agent.home)}</b>
      </div>
      <div class="household-grid">
        <span class="${pantryTone}"><b>${home.pantry}/${home.pantryCapacity}</b><small>Pantry</small></span>
        <span class="${toiletriesTone}"><b>${home.toiletries}/${home.supplyCapacity}</b><small>Toiletries</small></span>
        <span class="${cleaningTone}"><b>${home.cleaningSupplies}/${home.supplyCapacity}</b><small>Cleaning</small></span>
        <span class="${clutterTone}"><b>${Math.round(home.clutter)}</b><small>Clutter</small></span>
        <span class="${laundryTone}"><b>${Math.round(home.laundry)}</b><small>Laundry</small></span>
        <span class="${sleepTone}"><b>${Math.round(home.sleepQuality)}</b><small>Sleep</small></span>
      </div>
      <div class="household-comfort">
        <span>Comfort ${Math.round(home.homeComfort)}</span>
        <b>${home.choresDoneToday} chore${home.choresDoneToday === 1 ? "" : "s"} today</b>
        <i><em style="--value: ${clamp(home.homeComfort)}%"></em></i>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No home history yet.</small>`
      }
    </section>
  `;
};

const lifeAdminCategoryLabel: Record<SimAgent["lifeAdmin"]["dominantCategory"], string> = {
  paperwork: "Paperwork",
  supplies: "Supplies",
  homeCare: "Home Care",
  healthFollowup: "Health",
  civic: "Civic",
  money: "Money"
};

const renderLifeAdmin = (agent: SimAgent) => {
  const admin = agent.lifeAdmin;
  const tone = admin.urgency >= 82 ? "bad" : admin.urgency >= 64 || admin.load >= 62 ? "warn" : admin.load <= 22 ? "good" : "neutral";
  const paperworkTone = admin.paperwork >= 70 ? "bad" : admin.paperwork >= 44 ? "warn" : "good";
  const suppliesTone = admin.supplies >= 70 ? "bad" : admin.supplies >= 44 ? "warn" : "good";
  const homeTone = admin.homeCare >= 70 ? "bad" : admin.homeCare >= 44 ? "warn" : "good";
  const healthTone = admin.healthFollowup >= 70 ? "bad" : admin.healthFollowup >= 44 ? "warn" : "good";
  const civicTone = admin.civic >= 70 ? "bad" : admin.civic >= 44 ? "warn" : "good";
  const moneyTone = admin.money >= 70 ? "bad" : admin.money >= 44 ? "warn" : "good";
  const actions = admin.suggestedActions.slice(0, 4);
  const recent = admin.recent.slice(0, 2);
  return `
    <section class="life-admin-card ${tone}" aria-label="Life admin">
      <div class="life-admin-heading">
        <span>Life Admin</span>
        <b>${escapeHtml(lifeAdminCategoryLabel[admin.dominantCategory])}</b>
      </div>
      <p>${escapeHtml(admin.nextTask)}</p>
      <small>${escapeHtml(admin.detail)}</small>
      <div class="life-admin-flow">
        <span>Load ${Math.round(admin.load)}</span>
        <b>Urgency ${Math.round(admin.urgency)}</b>
        <i><em style="--value: ${clamp(Math.max(admin.load, admin.urgency))}%"></em></i>
      </div>
      <div class="life-admin-grid">
        <span class="${paperworkTone}"><b>${Math.round(admin.paperwork)}</b><small>Paper</small></span>
        <span class="${suppliesTone}"><b>${Math.round(admin.supplies)}</b><small>Supply</small></span>
        <span class="${homeTone}"><b>${Math.round(admin.homeCare)}</b><small>Home</small></span>
        <span class="${healthTone}"><b>${Math.round(admin.healthFollowup)}</b><small>Health</small></span>
        <span class="${civicTone}"><b>${Math.round(admin.civic)}</b><small>Civic</small></span>
        <span class="${moneyTone}"><b>${Math.round(admin.money)}</b><small>Money</small></span>
      </div>
      <div class="life-admin-actions">
        ${actions.map((action) => `<em>${escapeHtml(titleCase(action.replace(/_/g, " ")))}</em>`).join("")}
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No admin history yet.</small>`
      }
    </section>
  `;
};

const renderOutfit = (agent: SimAgent) => {
  const outfit = agent.outfit;
  const cleanTone = outfit.cleanliness < 34 ? "bad" : outfit.cleanliness < 58 ? "warn" : "good";
  const wearTone = outfit.wear > 78 ? "bad" : outfit.wear > 58 ? "warn" : "good";
  const confidenceTone = outfit.confidence < 36 ? "bad" : outfit.confidence < 58 ? "warn" : "good";
  const recent = outfit.recent.slice(0, 2);
  return `
    <section class="outfit-card ${cleanTone === "bad" || wearTone === "bad" ? "bad" : "neutral"}" aria-label="Outfit">
      <div class="outfit-heading">
        <span>Outfit</span>
        <b>${escapeHtml(titleCase(outfit.style))}</b>
      </div>
      <div class="outfit-swatch ${escapeHtml(outfit.style)}" style="--agent-hue: ${agent.dna.appearanceHue}deg">
        <i></i><i></i><i></i>
      </div>
      <div class="outfit-grid">
        <span class="${cleanTone}"><b>${Math.round(outfit.cleanliness)}</b><small>Clean</small></span>
        <span class="${wearTone}"><b>${Math.round(outfit.wear)}</b><small>Wear</small></span>
        <span class="${confidenceTone}"><b>${Math.round(outfit.confidence)}</b><small>Confidence</small></span>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No outfit history yet.</small>`
      }
    </section>
  `;
};

const renderNutrition = (agent: SimAgent) => {
  const nutrition = agent.nutrition;
  const qualityTone = nutrition.quality < 32 ? "bad" : nutrition.quality < 54 ? "warn" : "good";
  const hydrationTone = nutrition.hydration < 28 ? "bad" : nutrition.hydration < 50 ? "warn" : "good";
  const varietyTone = nutrition.variety < 30 ? "bad" : nutrition.variety < 48 ? "warn" : "good";
  const fullnessTone = nutrition.fullness < 32 ? "bad" : nutrition.fullness < 52 ? "warn" : "good";
  const recent = nutrition.recent.slice(0, 2);
  return `
    <section class="nutrition-card ${qualityTone === "bad" || hydrationTone === "bad" ? "bad" : "neutral"}" aria-label="Nutrition">
      <div class="nutrition-heading">
        <span>Nutrition</span>
        <b>${escapeHtml(nutrition.lastMealLabel ?? "No meal yet")}</b>
      </div>
      <div class="nutrition-grid">
        <span class="${qualityTone}"><b>${Math.round(nutrition.quality)}</b><small>Quality</small></span>
        <span class="${hydrationTone}"><b>${Math.round(nutrition.hydration)}</b><small>Hydration</small></span>
        <span class="${varietyTone}"><b>${Math.round(nutrition.variety)}</b><small>Variety</small></span>
        <span class="${fullnessTone}"><b>${Math.round(nutrition.fullness)}</b><small>Fullness</small></span>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No food history yet.</small>`
      }
    </section>
  `;
};

const renderLeisure = (agent: SimAgent) => {
  const leisure = agent.leisure;
  const funTone = leisure.fun < 24 ? "bad" : leisure.fun < 48 ? "warn" : "good";
  const boredomTone = leisure.boredom > 82 ? "bad" : leisure.boredom > 58 ? "warn" : "good";
  const curiosityTone = leisure.curiosity > 82 ? "warn" : leisure.curiosity > 56 ? "good" : "neutral";
  const recent = leisure.recent.slice(0, 2);
  return `
    <section class="leisure-card ${funTone === "bad" || boredomTone === "bad" ? "bad" : "neutral"}" aria-label="Leisure">
      <div class="leisure-heading">
        <span>Leisure</span>
        <b>${escapeHtml(titleCase(leisure.hobby.replace(/_/g, " ")))}</b>
      </div>
      <div class="leisure-grid">
        <span class="${funTone}"><b>${Math.round(leisure.fun)}</b><small>Fun</small></span>
        <span class="${boredomTone}"><b>${Math.round(leisure.boredom)}</b><small>Boredom</small></span>
        <span class="${curiosityTone}"><b>${Math.round(leisure.curiosity)}</b><small>Curiosity</small></span>
        <span class="${agent.routine.recreationToday > 0 ? "good" : "neutral"}"><b>${agent.routine.recreationToday}</b><small>Today</small></span>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No leisure history yet.</small>`
      }
    </section>
  `;
};

const renderSleep = (agent: SimAgent) => {
  const sleep = agent.sleep;
  const debtTone = sleep.sleepDebt > 78 ? "bad" : sleep.sleepDebt > 58 ? "warn" : "good";
  const rhythmTone = sleep.circadianFatigue > 82 ? "bad" : sleep.circadianFatigue > 58 ? "warn" : "good";
  const hoursTone = sleep.hoursSleptLastNight <= 4 ? "bad" : sleep.hoursSleptLastNight < 6 ? "warn" : "good";
  const recent = sleep.recent.slice(0, 2);
  return `
    <section class="sleep-card ${debtTone === "bad" || rhythmTone === "bad" ? "bad" : "neutral"}" aria-label="Sleep rhythm">
      <div class="sleep-heading">
        <span>Sleep</span>
        <b>${escapeHtml(titleCase(sleep.chronotype.replace(/_/g, " ")))}</b>
      </div>
      <div class="sleep-window">
        <span>${clockLabel(sleep.bedtimeTarget)} bedtime</span>
        <span>${clockLabel(sleep.wakeTarget)} wake</span>
      </div>
      <div class="sleep-grid">
        <span class="${debtTone}"><b>${Math.round(sleep.sleepDebt)}</b><small>Debt</small></span>
        <span class="${rhythmTone}"><b>${Math.round(sleep.circadianFatigue)}</b><small>Rhythm</small></span>
        <span class="${hoursTone}"><b>${sleep.hoursSleptLastNight.toFixed(1)}</b><small>Hours</small></span>
        <span class="${agent.routine.sleptToday ? "good" : "neutral"}"><b>${agent.routine.sleptToday ? "yes" : "no"}</b><small>Today</small></span>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No sleep history yet.</small>`
      }
    </section>
  `;
};

const renderAutonomy = (agent: SimAgent) => {
  const autonomy = agent.autonomy;
  const dignityTone = autonomy.dignity < 28 ? "bad" : autonomy.dignity < 48 ? "warn" : "good";
  const controlTone = autonomy.control < 28 ? "bad" : autonomy.control < 50 ? "warn" : "good";
  const overwhelmTone = autonomy.overwhelm > 82 ? "bad" : autonomy.overwhelm > 62 ? "warn" : "good";
  const recent = autonomy.recent.slice(0, 2);
  return `
    <section class="autonomy-card ${overwhelmTone === "bad" || dignityTone === "bad" || controlTone === "bad" ? "bad" : "neutral"}" aria-label="Autonomy">
      <div class="autonomy-heading">
        <span>Autonomy</span>
        <b>${autonomy.overwhelm > 72 ? "Pressure" : autonomy.control > 68 ? "In Control" : "Agency"}</b>
      </div>
      <div class="autonomy-grid">
        <span class="${dignityTone}"><b>${Math.round(autonomy.dignity)}</b><small>Dignity</small></span>
        <span class="${controlTone}"><b>${Math.round(autonomy.control)}</b><small>Control</small></span>
        <span class="${overwhelmTone}"><b>${Math.round(autonomy.overwhelm)}</b><small>Overwhelm</small></span>
        <span class="${agent.routine.autonomyMomentsToday > 0 ? "good" : "neutral"}"><b>${agent.routine.autonomyMomentsToday}</b><small>Today</small></span>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No autonomy history yet.</small>`
      }
    </section>
  `;
};

const renderEmotion = (agent: SimAgent) => {
  const emotion = agent.emotion;
  const composureTone = emotion.composure < 28 ? "bad" : emotion.composure < 48 ? "warn" : "good";
  const lonelinessTone = emotion.loneliness > 84 ? "bad" : emotion.loneliness > 64 ? "warn" : "good";
  const confidenceTone = emotion.confidence < 28 ? "bad" : emotion.confidence < 48 ? "warn" : "good";
  const irritationTone = emotion.irritation > 82 ? "bad" : emotion.irritation > 62 ? "warn" : "good";
  const hopeTone = emotion.hope < 28 ? "bad" : emotion.hope < 48 ? "warn" : "good";
  const recent = emotion.recent.slice(0, 2);
  const headline =
    emotion.irritation > 78 || emotion.composure < 30
      ? "Frayed"
      : emotion.loneliness > 78
        ? "Lonely"
        : emotion.hope > 76 && emotion.confidence > 62
          ? "Hopeful"
          : "Steady";
  return `
    <section class="emotion-card ${composureTone === "bad" || irritationTone === "bad" || hopeTone === "bad" || lonelinessTone === "bad" ? "bad" : "neutral"}" aria-label="Emotional state">
      <div class="emotion-heading">
        <span>Emotion</span>
        <b>${headline}</b>
      </div>
      <div class="emotion-grid">
        <span class="${composureTone}"><b>${Math.round(emotion.composure)}</b><small>Composure</small></span>
        <span class="${lonelinessTone}"><b>${Math.round(emotion.loneliness)}</b><small>Lonely</small></span>
        <span class="${confidenceTone}"><b>${Math.round(emotion.confidence)}</b><small>Confident</small></span>
        <span class="${irritationTone}"><b>${Math.round(emotion.irritation)}</b><small>Irritation</small></span>
        <span class="${hopeTone}"><b>${Math.round(emotion.hope)}</b><small>Hope</small></span>
      </div>
      <div class="emotion-flow">
        <span>Hope ${Math.round(emotion.hope)}</span>
        <b>Calm ${Math.round(emotion.composure)}</b>
        <i><em style="--value: ${clamp((emotion.hope + emotion.composure + emotion.confidence) / 3)}%"></em></i>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No emotional history yet.</small>`
      }
    </section>
  `;
};

const renderTimeManagement = (agent: SimAgent) => {
  const time = agent.time;
  const punctualityTone = time.punctuality < 32 ? "bad" : time.punctuality < 52 ? "warn" : "good";
  const awarenessTone = time.timeAwareness < 34 ? "warn" : time.timeAwareness > 68 ? "good" : "neutral";
  const rushTone = time.rush > 82 ? "bad" : time.rush > 62 ? "warn" : "good";
  const dayTone = time.missedWindowsToday > 0 ? "bad" : time.lateWindowsToday > 0 ? "warn" : time.keptWindowsToday > 0 ? "good" : "neutral";
  const recent = time.recent.slice(0, 2);
  return `
    <section class="time-card ${rushTone === "bad" || dayTone === "bad" ? "bad" : "neutral"}" aria-label="Time management">
      <div class="time-heading">
        <span>Time</span>
        <b>${time.rush > 72 ? "Rushed" : time.keptWindowsToday > 0 ? "On Track" : "Open Day"}</b>
      </div>
      <div class="time-grid">
        <span class="${punctualityTone}"><b>${Math.round(time.punctuality)}</b><small>Punctual</small></span>
        <span class="${awarenessTone}"><b>${Math.round(time.timeAwareness)}</b><small>Aware</small></span>
        <span class="${rushTone}"><b>${Math.round(time.rush)}</b><small>Rush</small></span>
        <span class="${dayTone}"><b>${time.keptWindowsToday}/${time.lateWindowsToday}/${time.missedWindowsToday}</b><small>K/L/M</small></span>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No schedule history yet.</small>`
      }
    </section>
  `;
};

const renderRoutineRhythm = (agent: SimAgent) => {
  const rhythm = agent.rhythm;
  const workTone = rhythm.work < 32 ? "bad" : rhythm.work < 52 ? "warn" : "good";
  const careTone = rhythm.care < 32 ? "bad" : rhythm.care < 52 ? "warn" : "good";
  const homeTone = rhythm.home < 32 ? "bad" : rhythm.home < 52 ? "warn" : "good";
  const socialTone = rhythm.social < 32 ? "bad" : rhythm.social < 52 ? "warn" : "good";
  const financeTone = rhythm.finance < 32 ? "bad" : rhythm.finance < 52 ? "warn" : "good";
  const driftTone = rhythm.drift > 78 ? "bad" : rhythm.drift > 60 ? "warn" : rhythm.momentum > 70 ? "good" : "neutral";
  const recent = rhythm.recent.slice(0, 2);
  return `
    <section class="rhythm-card ${driftTone === "bad" ? "bad" : "neutral"}" aria-label="Daily rhythm">
      <div class="rhythm-heading">
        <span>Rhythm</span>
        <b>${escapeHtml(titleCase(rhythm.identity))}</b>
      </div>
      <div class="rhythm-grid">
        <span class="${workTone}"><b>${Math.round(rhythm.work)}</b><small>Work</small></span>
        <span class="${careTone}"><b>${Math.round(rhythm.care)}</b><small>Care</small></span>
        <span class="${homeTone}"><b>${Math.round(rhythm.home)}</b><small>Home</small></span>
        <span class="${socialTone}"><b>${Math.round(rhythm.social)}</b><small>Social</small></span>
        <span class="${financeTone}"><b>${Math.round(rhythm.finance)}</b><small>Money</small></span>
      </div>
      <div class="rhythm-flow">
        <span>Momentum ${Math.round(rhythm.momentum)}</span>
        <b>Drift ${Math.round(rhythm.drift)}</b>
        <i><em style="--value: ${clamp(rhythm.momentum)}%"></em></i>
      </div>
      <div class="rhythm-counters">
        <span>${rhythm.streak} day streak</span>
        <span>${rhythm.strainDays} strain day${rhythm.strainDays === 1 ? "" : "s"}</span>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No rhythm history yet.</small>`
      }
    </section>
  `;
};

const renderActionOptions = (agent: SimAgent) => {
  const options = agent.availableActions.slice(0, 4);
  if (options.length === 0) return "";
  return `
    <section class="action-options-card" aria-label="Decision options">
      <div class="action-options-heading">
        <span>Decision Options</span>
        <b>${escapeHtml(options.find((option) => option.selected)?.label ?? options[0]?.label ?? "Choosing")}</b>
      </div>
      <ol>
        ${options
          .map(
            (option) => `
              <li class="${escapeHtml(option.tone)} ${option.selected ? "selected" : ""}">
                <strong>${escapeHtml(option.label)}</strong>
                <em>${escapeHtml(option.intent?.label ?? titleCase(option.action))}</em>
                <span>${escapeHtml(option.location)}</span>
                <small>${escapeHtml(option.reason)} / score ${option.utility}</small>
              </li>
            `
          )
          .join("")}
      </ol>
    </section>
  `;
};

const reputationEntries = (agent: SimAgent) => [
  { key: "reliability", label: "Reliable", value: agent.reputation.reliability, tone: agent.reputation.reliability >= 68 ? "good" : "neutral" },
  { key: "warmth", label: "Warm", value: agent.reputation.warmth, tone: agent.reputation.warmth >= 68 ? "good" : "neutral" },
  { key: "ambition", label: "Driven", value: agent.reputation.ambition, tone: agent.reputation.ambition >= 70 ? "good" : "neutral" },
  { key: "trouble", label: "Trouble", value: agent.reputation.trouble, tone: agent.reputation.trouble >= 58 ? "bad" : "neutral" }
] as const;

const reputationRead = (agent: SimAgent) => {
  const standouts = reputationEntries(agent)
    .map((entry) => ({ ...entry, score: entry.key === "trouble" ? entry.value + 8 : entry.value }))
    .filter((entry) => (entry.key === "trouble" ? entry.value >= 42 : entry.value >= 56))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  return standouts.length > 0 ? standouts.map((entry) => entry.label).join(" + ") : "New in town";
};

const renderReputation = (agent: SimAgent) => `
  <section class="reputation-card" aria-label="Town reputation">
    <div class="reputation-heading">
      <span>Town Read</span>
      <b>${escapeHtml(reputationRead(agent))}</b>
    </div>
    <div class="reputation-grid">
      ${reputationEntries(agent)
        .map(
          (entry) => `
            <div class="reputation-meter ${escapeHtml(entry.tone)}">
              <span>${escapeHtml(entry.label)}</span>
              <b>${entry.value}</b>
              <i><em style="--value: ${entry.value}%"></em></i>
            </div>
          `
        )
        .join("")}
    </div>
  </section>
`;

const plural = (count: number, singular: string, pluralLabel = `${singular}s`) => `${count} ${count === 1 ? singular : pluralLabel}`;
const signedCredits = (amount: number) => (amount === 0 ? "0" : `${amount > 0 ? "+" : ""}${amount}`);
const spentCredits = (amount: number) => (amount === 0 ? "0" : `-${amount}`);

const dayArcTone = (tone: "good" | "warn" | "bad" | "neutral") => tone;

const renderDayArc = (agent: SimAgent) => {
  const relationships = Object.keys(agent.relationshipDetails).length;
  const errands = [
    agent.routine.washedToday ? "washed" : "",
    agent.routine.checkedMailToday ? "mail" : "",
    agent.routine.paidRentToday ? "rent paid" : "",
    agent.routine.medicalVisitToday ? (agent.medical.isHospitalized ? "hospital" : "clinic") : "",
    agent.medicalDebt > 0 ? "medical bill" : "",
    agent.budget.livingCostDue > 0 ? "living costs" : ""
  ].filter(Boolean);
  const socialDetail =
    agent.routine.conflictsToday > 0
      ? `${plural(agent.routine.conflictsToday, "conflict")}`
      : agent.routine.bondsToday > 0
        ? `${plural(agent.routine.bondsToday, "bond")}`
        : agent.routine.deescalationsToday > 0
          ? `${plural(agent.routine.deescalationsToday, "calm save")}`
        : agent.routine.socializedToday
          ? "spent time out"
          : "quiet so far";
  const foodTone = agent.nutrition.hydration < 28 || agent.nutrition.quality < 30 ? "bad" : agent.routine.mealsToday > 0 ? "good" : agent.hunger > 70 ? "bad" : "warn";
  const workTone = agent.routine.workedToday || agent.routine.sickLeaveToday ? "good" : agent.money < 12 ? "bad" : "neutral";
  const workDetail = agent.routine.sickLeaveToday ? (agent.routine.sickLeaveReason ?? "called in sick") : agent.routine.lastMaintenance ? agent.routine.lastMaintenance : `${agent.money} credits now`;
  const socialTone = agent.routine.conflictsToday > 0 ? "bad" : agent.routine.bondsToday > 0 || agent.routine.deescalationsToday > 0 ? "good" : "neutral";
  const leisureTone = agent.routine.recreationToday > 0 ? "good" : agent.leisure.boredom > 82 || agent.leisure.fun < 22 ? "bad" : agent.leisure.boredom > 58 ? "warn" : "neutral";
  const agencyTone =
    agent.autonomy.overwhelm > 82 || agent.autonomy.dignity < 26
      ? "bad"
      : agent.autonomy.overwhelm > 64 || agent.autonomy.control < 42
        ? "warn"
        : agent.routine.autonomyMomentsToday > 0
          ? "good"
          : "neutral";
  const timeTone =
    agent.time.missedWindowsToday > 0 || agent.time.rush > 84
      ? "bad"
      : agent.time.lateWindowsToday > 0 || agent.time.rush > 64
        ? "warn"
        : agent.time.keptWindowsToday > 0
          ? "good"
          : "neutral";
  const timeDetail =
    agent.time.missedWindowsToday > 0
      ? `${agent.time.missedWindowsToday} missed`
      : agent.time.lateWindowsToday > 0
        ? `${agent.time.lateWindowsToday} late`
        : agent.time.keptWindowsToday > 0
          ? `${agent.time.keptWindowsToday} kept`
          : `${Math.round(agent.time.rush)} rush`;
  const rhythmTone = agent.rhythm.drift > 78 ? "bad" : agent.rhythm.drift > 62 ? "warn" : agent.rhythm.momentum > 72 || agent.rhythm.streak >= 3 ? "good" : "neutral";
  const emotionTone =
    agent.emotion.irritation > 84 || agent.emotion.composure < 24 || agent.emotion.hope < 24
      ? "bad"
      : agent.emotion.loneliness > 72 || agent.emotion.irritation > 66 || agent.emotion.hope < 42
        ? "warn"
        : agent.emotion.hope > 76 && agent.emotion.confidence > 62
          ? "good"
          : "neutral";
  const emotionDetail =
    agent.emotion.irritation > 78 || agent.emotion.composure < 30
      ? `${Math.round(agent.emotion.composure)} calm / ${Math.round(agent.emotion.irritation)} irritation`
      : agent.emotion.loneliness > 72
        ? `${Math.round(agent.emotion.loneliness)} loneliness`
        : `${Math.round(agent.emotion.hope)} hope / ${Math.round(agent.emotion.confidence)} confidence`;
  const errandTone = agent.medical.isHospitalized ? "bad" : errands.length > 0 ? "good" : agent.rentDue > 0 || agent.medicalDebt > 0 || agent.budget.livingCostDue > 0 ? "warn" : "neutral";
  return `
    <section class="day-arc" aria-label="Today so far">
      <div class="day-arc-heading">
        <span>Today So Far</span>
        <b>${escapeHtml(agent.lifeProfile.archetype)} arc</b>
      </div>
      <div class="day-arc-grid">
        <div class="${dayArcTone(workTone)}"><span>Work</span><b>${agent.routine.workedToday ? `+${agent.routine.earningsToday}` : agent.routine.sickLeaveToday ? "sick" : "open"}</b><small>${escapeHtml(workDetail)}</small></div>
        <div class="${dayArcTone(foodTone)}"><span>Food</span><b>${agent.routine.mealsToday}</b><small>hunger ${Math.round(agent.hunger)} / water ${Math.round(agent.nutrition.hydration)}</small></div>
        <div class="${dayArcTone(socialTone)}"><span>Social</span><b>${agent.routine.bondsToday + agent.routine.deescalationsToday - agent.routine.conflictsToday}</b><small>${escapeHtml(socialDetail)}</small></div>
        <div class="${dayArcTone(leisureTone)}"><span>Fun</span><b>${agent.routine.recreationToday}</b><small>${Math.round(agent.leisure.fun)} fun / ${Math.round(agent.leisure.boredom)} bored</small></div>
        <div class="${dayArcTone(agencyTone)}"><span>Agency</span><b>${agent.routine.autonomyMomentsToday}</b><small>${Math.round(agent.autonomy.control)} control / ${Math.round(agent.autonomy.overwhelm)} pressure</small></div>
        <div class="${dayArcTone(timeTone)}"><span>Time</span><b>${timeDetail}</b><small>${Math.round(agent.time.punctuality)} punctual / ${Math.round(agent.time.rush)} rush</small></div>
        <div class="${dayArcTone(rhythmTone)}"><span>Rhythm</span><b>${Math.round(agent.rhythm.momentum)}</b><small>${escapeHtml(agent.rhythm.identity)} / ${Math.round(agent.rhythm.drift)} drift</small></div>
        <div class="${dayArcTone(emotionTone)}"><span>Emotion</span><b>${Math.round(agent.emotion.hope)}</b><small>${escapeHtml(emotionDetail)}</small></div>
        <div class="${dayArcTone(errandTone)}"><span>Errands</span><b>${errands.length}</b><small>${escapeHtml(errands.length > 0 ? errands.join(", ") : "none yet")}</small></div>
      </div>
      <div class="day-arc-foot">
        <span>${escapeHtml(plural(agent.inventory.length, "item"))} stored</span>
        <span>${escapeHtml(plural(relationships, "relationship"))}</span>
        <span>${agent.routine.maintenanceToday > 0 ? `${agent.routine.maintenanceToday} service act${agent.routine.maintenanceToday === 1 ? "" : "s"}` : "no service yet"}</span>
        <span>${agent.routine.deescalationsToday > 0 ? `${agent.routine.deescalationsToday} kept-cool moment${agent.routine.deescalationsToday === 1 ? "" : "s"}` : "no tense saves"}</span>
        <span>${agent.rentDue > 0 ? `${agent.rentDue} rent due` : "rent clear"}</span>
        <span>${agent.medicalDebt > 0 ? `${agent.medicalDebt} medical bill` : "medical clear"}</span>
        <span>${agent.budget.livingCostDue > 0 ? `${agent.budget.livingCostDue} living due` : "basics clear"}</span>
      </div>
    </section>
  `;
};

const commitmentStatusLabel: Record<SimAgent["commitments"][number]["status"], string> = {
  pending: "Planned",
  due: "Open",
  done: "Done",
  missed: "Missed"
};

const renderCommitments = (agent: SimAgent) => {
  const commitments = agent.commitments.slice(0, 7);
  if (commitments.length === 0) return "";
  const openCount = commitments.filter((commitment) => commitment.status === "pending" || commitment.status === "due").length;
  const troubleCount = commitments.filter((commitment) => commitment.status === "missed").length;
  const doneCount = commitments.filter((commitment) => commitment.status === "done").length;
  const headingTone = troubleCount > 0 ? "bad" : openCount > 0 ? "warn" : "good";

  return `
    <section class="commitment-card ${headingTone}" aria-label="Daily commitments">
      <div class="commitment-heading">
        <span>Daily Rhythm</span>
        <b>${doneCount}/${commitments.length} kept</b>
      </div>
      <ol>
        ${commitments
          .map(
            (commitment) => `
              <li class="${escapeHtml(commitment.tone)} ${escapeHtml(commitment.status)} ${escapeHtml(commitment.category)}">
                <span>
                  <strong>${escapeHtml(commitment.label)}</strong>
                  <small>${escapeHtml(commitment.detail)}</small>
                </span>
                <em>${escapeHtml(commitmentStatusLabel[commitment.status])}</em>
                <b>${escapeHtml(commitment.windowLabel)}</b>
                <i><u style="--value: ${clamp(commitment.pressure)}%"></u></i>
              </li>
            `
          )
          .join("")}
      </ol>
    </section>
  `;
};

const personalNoticeStatusLabel: Record<SimAgent["personalNotices"][number]["status"], string> = {
  unread: "Unread",
  read: "Open",
  handled: "Handled",
  expired: "Missed"
};

const renderPersonalNotices = (agent: SimAgent) => {
  const notices = agent.personalNotices.slice(0, 4);
  if (notices.length === 0) return "";
  const active = notices.filter((notice) => notice.status === "unread" || notice.status === "read");
  const headingTone = active.some((notice) => notice.tone === "bad") ? "bad" : active.some((notice) => notice.tone === "warn") ? "warn" : active.length > 0 ? "neutral" : "good";
  return `
    <section class="personal-mail-card ${headingTone}" aria-label="Personal mail">
      <div class="personal-mail-heading">
        <span>Personal Mail</span>
        <b>${active.length > 0 ? `${active.length} active` : "caught up"}</b>
      </div>
      <ol>
        ${notices
          .map(
            (notice) => `
              <li class="${escapeHtml(notice.tone)} ${escapeHtml(notice.status)} ${escapeHtml(notice.kind)}">
                <span>
                  <strong>${escapeHtml(notice.label)}</strong>
                  <small>${escapeHtml(notice.detail)}</small>
                </span>
                <em>${escapeHtml(personalNoticeStatusLabel[notice.status])}</em>
                <b>Day ${notice.dueDay}</b>
                <i>${escapeHtml(notice.actions.map((action) => titleCase(action)).slice(0, 2).join(" / "))}</i>
              </li>
            `
          )
          .join("")}
      </ol>
    </section>
  `;
};

const renderFinanceLedger = (agent: SimAgent) => {
  const todaysEntries = agent.finances.filter((entry) => entry.day === agent.routine.day);
  const income = todaysEntries.filter((entry) => entry.tone === "income").reduce((sum, entry) => sum + Math.max(0, entry.amount), 0);
  const spending = todaysEntries.filter((entry) => entry.tone === "expense").reduce((sum, entry) => sum + Math.abs(Math.min(0, entry.amount)), 0);
  const newDebt = todaysEntries.filter((entry) => entry.tone === "debt").reduce((sum, entry) => sum + Math.max(0, entry.amount), 0);
  const billsDue = agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue;
  const afterBills = agent.money - billsDue;
  const budgetOver = Math.max(0, agent.budget.spentToday - agent.budget.dailySpendLimit);
  const savingsProgress = agent.budget.savingsGoal > 0 ? (agent.budget.savings / agent.budget.savingsGoal) * 100 : 100;
  const creditTone = agent.budget.creditScore < 540 ? "bad" : agent.budget.creditScore < 640 ? "warn" : "good";
  const ledgerTone = afterBills < 0 || agent.budget.creditScore < 500 ? "bad" : budgetOver > 0 || billsDue > 0 || spending > income ? "warn" : "good";
  const entries = agent.finances.slice(0, 4);
  const billPressureNote =
    agent.budget.lateFeesToday > 0
      ? `late fee +${agent.budget.lateFeesToday}`
      : agent.budget.hardshipDeferrals > 0
        ? `${agent.budget.hardshipDeferrals} protected day${agent.budget.hardshipDeferrals === 1 ? "" : "s"}`
        : agent.budget.overdueBillDays > 0
          ? `${agent.budget.overdueBillDays} overdue day${agent.budget.overdueBillDays === 1 ? "" : "s"}`
          : "no overdue bills";

  return `
    <section class="finance-card ${ledgerTone}" aria-label="Money trail">
      <div class="finance-heading">
        <span>Money Trail</span>
        <b>${afterBills >= 0 ? `${afterBills} after bills` : `${Math.abs(afterBills)} short`} / credit ${agent.budget.creditScore}</b>
      </div>
      <div class="finance-summary">
        <span class="income"><b>${signedCredits(income)}</b><small>In</small></span>
        <span class="expense"><b>${spentCredits(spending)}</b><small>Out</small></span>
        <span class="${newDebt > 0 ? "debt" : ""}"><b>${newDebt}</b><small>New Debt</small></span>
        <span class="${afterBills < 0 ? "debt" : ""}"><b>${afterBills}</b><small>After Bills</small></span>
      </div>
      <div class="budget-board">
        <span class="${agent.budget.savings >= agent.budget.savingsGoal ? "good" : agent.budget.savings < agent.budget.dailySpendLimit ? "warn" : "neutral"}">
          <b>${agent.budget.savings}/${agent.budget.savingsGoal}</b>
          <small>Savings</small>
          <i><em style="--value: ${clamp(savingsProgress)}%"></em></i>
        </span>
        <span class="${budgetOver > 0 ? "warn" : "good"}">
          <b>${agent.budget.spentToday}/${agent.budget.dailySpendLimit}</b>
          <small>Budget</small>
          <i><em style="--value: ${clamp(agent.budget.dailySpendLimit > 0 ? (agent.budget.spentToday / agent.budget.dailySpendLimit) * 100 : 0)}%"></em></i>
        </span>
        <span class="${creditTone}">
          <b>${agent.budget.creditScore}</b>
          <small>Civic Credit</small>
          <i><em style="--value: ${clamp(((agent.budget.creditScore - 300) / 550) * 100)}%"></em></i>
        </span>
        <span class="${agent.budget.emergencyWithdrawalsToday > 0 ? "warn" : "neutral"}">
          <b>${agent.budget.emergencyWithdrawalsToday}</b>
          <small>Emergency</small>
          <i><em style="--value: ${clamp(agent.budget.savingsGoal > 0 ? (agent.budget.emergencyWithdrawalsToday / agent.budget.savingsGoal) * 100 : 0)}%"></em></i>
        </span>
      </div>
      <div class="budget-note">
        <span>${agent.budget.onTimeBillStreak} bill streak</span>
        <span>${agent.budget.missedBillCount} missed</span>
        <span>${escapeHtml(billPressureNote)}</span>
        <span>${escapeHtml(agent.budget.lastReview)}</span>
      </div>
      <ol class="finance-ledger">
        ${
          entries.length > 0
            ? entries
                .map(
                  (entry) => `
                    <li class="${escapeHtml(entry.tone)}">
                      <time>${escapeHtml(entry.worldTime)}</time>
                      <span>
                        <b>${escapeHtml(entry.label)}</b>
                        <small>${escapeHtml(titleCase(entry.category))} / bal ${entry.balanceAfter}</small>
                      </span>
                      <strong>${entry.tone === "debt" ? `due +${entry.amount}` : signedCredits(entry.amount)}</strong>
                    </li>
                  `
                )
                .join("")
            : `<li class="neutral empty"><span><b>No money movement yet.</b><small>Work, food, rent, and care will appear here.</small></span></li>`
        }
      </ol>
    </section>
  `;
};

const eveningOutcomeLabel: Record<SimAgent["eveningPlan"]["outcome"], string> = {
  pending: "Pending",
  bonded: "Bonded",
  quiet: "Quiet",
  conflict: "Tense",
  skipped: "Skipped"
};

const renderEveningPlan = (agent: SimAgent) => {
  const plan = agent.eveningPlan;
  if (plan.intent === "none") return "";
  const tone = plan.outcome === "conflict" ? "bad" : plan.outcome === "skipped" ? "warn" : plan.resolved ? "good" : "neutral";
  return `
    <section class="evening-plan-card ${tone}" aria-label="Evening plan">
      <div>
        <span>Evening Plan</span>
        <b>${escapeHtml(plan.label)}</b>
      </div>
      <p>${escapeHtml(plan.detail)}</p>
      <small>${escapeHtml(eveningOutcomeLabel[plan.outcome])}</small>
    </section>
  `;
};

const objectStateTone = (state: SemanticObjectState) =>
  state.stock !== undefined && state.stock <= 0
    ? "bad"
    : state.servicePressure >= 82 || state.unmetDemand >= 5
      ? "bad"
    : state.crowdPressure >= 76
      ? "bad"
      : state.servicePressure >= 52 || state.unmetDemand >= 2 || state.crowdPressure >= 48 || state.heat > 72 || state.cleanliness < 32
        ? "warn"
        : "neutral";

const renderObjectState = (state: SemanticObjectState | null) => {
  if (!state) return "";
  const tone = objectStateTone(state);
  const stockLabel = state.stock !== undefined && state.capacity !== undefined ? `${state.stock}/${state.capacity}` : "n/a";
  const crowdLabel = state.occupants + state.queued > 0 ? `${state.occupants}/${state.queued}` : "0";
  const lastLine = state.lastUsedBy ? `Last: ${state.lastUsedBy} at ${state.lastUsedWorldTime}` : "Ready for first use";
  const hoursLine = state.hoursLabel
    ? `<small class="object-hours ${state.openNow === false ? "closed" : "open"}">${state.openNow === false ? "Closed" : "Open"} / ${escapeHtml(state.hoursLabel)}</small>`
    : "";
  return `
    <section class="object-state-card ${tone}" aria-label="Current object state">
      <div class="object-state-heading">
        <span>Current Object</span>
        <b>${escapeHtml(state.label)}</b>
      </div>
      <div class="object-state-grid">
        <span><b>${escapeHtml(stockLabel)}</b><small>Stock</small></span>
        <span><b>${state.usesToday}</b><small>Today</small></span>
        <span><b>${state.cleanliness}</b><small>Clean</small></span>
        <span><b>${state.heat}</b><small>Heat</small></span>
        <span><b>${escapeHtml(crowdLabel)}</b><small>Here/Q</small></span>
        <span><b>${state.crowdPressure}</b><small>Crowd</small></span>
        <span><b>${state.unmetDemand}</b><small>Demand</small></span>
        <span><b>${state.servicePressure}</b><small>Need</small></span>
      </div>
      ${state.lastIssue ? `<small class="object-issue">${escapeHtml(state.lastIssue)}</small>` : ""}
      <small>${escapeHtml(lastLine)}</small>
      ${hoursLine}
    </section>
  `;
};

const renderRelationships = (agent: SimAgent) => {
  const relationships = Object.values(agent.relationshipDetails)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || b.encounters - a.encounters)
    .slice(0, 3);

  if (relationships.length === 0) {
    return `<div class="relationship-list empty"><span>No close relationships yet.</span></div>`;
  }

  return `
    <div class="relationship-list">
      ${relationships
        .map((relationship) => {
          const supportLabel =
            relationship.supportBalance > 0
              ? `Owes ${relationship.supportBalance}`
              : relationship.supportBalance < 0
                ? `Ahead ${Math.abs(relationship.supportBalance)}`
                : "Even";
          return `
            <div class="relationship ${escapeHtml(relationship.attitude)}">
              <span>${escapeHtml(relationship.agentName)}</span>
              <b>${escapeHtml(titleCase(relationship.attitude))} / ${escapeHtml(relationship.lastGesture)}</b>
              <small>${relationship.score.toFixed(0)} score / ${relationship.encounters} encounter${relationship.encounters === 1 ? "" : "s"}</small>
              <em>
                <i>Trust ${Math.round(relationship.trust)}</i>
                <i>Tension ${Math.round(relationship.tension)}</i>
                <i>${escapeHtml(supportLabel)}</i>
              </em>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
};

const renderSocialCompass = (agent: SimAgent) => {
  const compass = agent.socialCompass;
  const belongingTone = compass.belonging < 28 ? "bad" : compass.belonging < 48 ? "warn" : "good";
  const trustTone = compass.trust < 28 ? "bad" : compass.trust < 48 ? "warn" : "good";
  const tensionTone = compass.tension > 82 ? "bad" : compass.tension > 58 ? "warn" : "good";
  const supportTone = compass.supportOwed >= 6 ? "bad" : compass.supportOwed >= 2 ? "warn" : compass.supportGiven > 0 ? "good" : "neutral";
  const peopleLine =
    compass.relationshipCount > 0
      ? `${compass.friendCount} friend${compass.friendCount === 1 ? "" : "s"} / ${compass.rivalCount} rival${compass.rivalCount === 1 ? "" : "s"}`
      : "no known people yet";
  const focusLine =
    compass.anchorName && compass.concernName
      ? `Anchor ${compass.anchorName}, concern ${compass.concernName}`
      : compass.anchorName
        ? `Anchor ${compass.anchorName}`
        : compass.concernName
          ? `Concern ${compass.concernName}`
          : "No strong social read yet";
  const recent = compass.recent.slice(0, 2);
  return `
    <section class="social-compass-card ${compass.stance === "strained" ? "bad" : compass.stance === "guarded" ? "warn" : compass.stance === "anchored" || compass.stance === "generous" ? "good" : "neutral"}" aria-label="Social compass">
      <div class="social-compass-heading">
        <span>Social Compass</span>
        <b>${escapeHtml(titleCase(compass.stance))}</b>
      </div>
      <small>${escapeHtml(compass.detail)}</small>
      <div class="social-compass-grid">
        <span class="${belongingTone}"><b>${Math.round(compass.belonging)}</b><small>Belong</small></span>
        <span class="${trustTone}"><b>${Math.round(compass.trust)}</b><small>Trust</small></span>
        <span class="${tensionTone}"><b>${Math.round(compass.tension)}</b><small>Tension</small></span>
        <span class="${supportTone}"><b>${compass.supportOwed > 0 ? compass.supportOwed : compass.supportGiven}</b><small>${compass.supportOwed > 0 ? "Owes" : "Given"}</small></span>
      </div>
      <div class="social-compass-lines">
        <span>${escapeHtml(peopleLine)}</span>
        <span>${escapeHtml(focusLine)}</span>
      </div>
      ${
        recent.length > 0
          ? `<ol>${recent.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>`
          : `<small>No social history yet.</small>`
      }
    </section>
  `;
};

const renderSocialMoments = (agent: SimAgent) => {
  const moments = agent.socialMoments.slice(0, 3);
  if (moments.length === 0) {
    return `<div class="social-moment-list empty"><span>No recent social moments.</span></div>`;
  }

  return `
    <div class="social-moment-list">
      <strong>Recent Social</strong>
      ${moments
        .map(
          (moment) => `
            <div class="social-moment ${escapeHtml(moment.tone)}">
              <span>${escapeHtml(moment.label)}</span>
              <b>${moment.otherAgentName ? escapeHtml(moment.otherAgentName) : escapeHtml(titleCase(moment.kind))}</b>
              <small>${escapeHtml(moment.detail)}</small>
              <em>
                <i>${moment.scoreDelta >= 0 ? "+" : ""}${moment.scoreDelta} score</i>
                <i>${moment.trustDelta >= 0 ? "+" : ""}${moment.trustDelta} trust</i>
                <i>${moment.supportDelta >= 0 ? "+" : ""}${moment.supportDelta} support</i>
              </em>
            </div>
          `
        )
        .join("")}
    </div>
  `;
};

const placeTone = (affinity: number, frustration: number): "good" | "warn" | "bad" | "neutral" => {
  if (frustration >= 45 && affinity < 8) return "bad";
  if (affinity >= 18) return "good";
  if (affinity < -12 || frustration >= 24) return "warn";
  return "neutral";
};

const renderPlaceMemory = (agent: SimAgent) => {
  const places = Object.values(agent.placeMemory)
    .sort((a, b) => Math.abs(b.affinity) + b.visits * 1.4 - (Math.abs(a.affinity) + a.visits * 1.4))
    .slice(0, 3);

  if (places.length === 0) {
    return `<div class="place-memory empty"><span>Places are still anonymous.</span></div>`;
  }

  return `
    <div class="place-memory">
      <strong>Place Memory</strong>
      ${places
        .map((place) => {
          const tone = placeTone(place.affinity, place.frustration);
          return `
            <div class="place-memory-item ${tone}">
              <span>${escapeHtml(place.structureName)}</span>
              <b>${place.affinity >= 0 ? "+" : ""}${place.affinity} affinity / ${place.visits} visit${place.visits === 1 ? "" : "s"}</b>
              <small>${escapeHtml(place.lastEvent)}</small>
              <em>
                <i>Trust ${Math.round(place.trust)}</i>
                <i>Frustration ${Math.round(place.frustration)}</i>
                <i>${escapeHtml(titleCase(place.lastAction))}</i>
              </em>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
};

const renderActivityMemory = (agent: SimAgent) => {
  const activities = Object.values(agent.activityMemory)
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.affinity) + b.visits * 1.4 - (Math.abs(a.affinity) + a.visits * 1.4))
    .slice(0, 4);

  if (activities.length === 0) return "";

  return `
    <div class="activity-memory">
      <strong>Activity Memory</strong>
      <div>
        ${activities
          .map((activity) => {
            const tone = placeTone(activity.affinity, activity.frustration);
            return `
              <span class="${tone}">
                <b>${escapeHtml(titleCase(activity.action))}</b>
                <small>${activity.affinity >= 0 ? "+" : ""}${activity.affinity} affinity / ${activity.visits}x</small>
                <i>${escapeHtml(activity.lastEvent)}</i>
              </span>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
};

const renderMemoryTrail = (agent: SimAgent) => {
  const memories = [...agent.memories].sort((a, b) => b.timestamp - a.timestamp).slice(0, 4);
  if (memories.length === 0) return "";
  return `
    <div class="memory-trail">
      <strong>Recent Story</strong>
      <ol>
        ${memories
          .map(
            (memory) => `
              <li class="${escapeHtml(memory.kind)}">
                <span>${escapeHtml(memoryKindLabel(memory.kind))}</span>
                <p>${escapeHtml(memory.text)}</p>
              </li>
            `
          )
          .join("")}
      </ol>
    </div>
  `;
};

const renderSelectedAgent = (agent: SimAgent | null, objectState: SemanticObjectState | null) => {
  if (!agent) {
    return `
      <div class="selected-empty">
        <span>Waiting</span>
        <strong>No agent selected</strong>
        <p>Spawn an agent to begin spectating their day.</p>
      </div>
    `;
  }

  const target = agent.medical.isHospitalized ? `${agent.medical.facilityName ?? "Clinic"} recovery stay` : (agent.target?.label ?? "choosing next stop");
  const progress = Math.round((agent.actionProgress ?? 0) * 100);
  const route = agent.target
    ? agent.medical.isHospitalized
      ? `${Math.round(progress)}% recovered / ${agent.medical.bill} bill`
      : `${Math.max(0, agent.target.routeLength - agent.target.waypoints.length)}/${agent.target.routeLength} route`
    : "no route";
  return `
    <article class="selected-card" style="--agent-hue: ${agent.dna.appearanceHue}deg">
      <div class="agent-hero">
        <div class="agent-portrait"><span>${escapeHtml(initials(agent.name))}</span></div>
        <div>
          <span class="eyebrow">Spectating</span>
        <strong>${escapeHtml(agent.name)}</strong>
          <span>${escapeHtml(titleCase(agent.job))} / ${escapeHtml(walletLabel(agent.walletAddress))}</span>
        </div>
      </div>

      <div class="agent-now">
        <span>${escapeHtml(titleCase(agent.currentAction))}</span>
        <strong>${escapeHtml(target)}</strong>
        <em>${escapeHtml(agent.target?.intent?.label ?? agent.lifePriority.label)}</em>
        <small>${escapeHtml(route)}</small>
        <i class="action-progress" aria-label="Action progress"><b style="--value: ${progress}%"></b></i>
      </div>

      ${renderLifeProfile(agent)}

      ${renderPersonalDrive(agent)}

      ${renderLifePriority(agent)}

      ${renderLifeAdmin(agent)}

      ${renderActiveIntention(agent)}

      ${renderDecisionRead(agent)}

      ${renderWantsAndFears(agent)}

      ${renderAspiration(agent)}

      ${renderCareer(agent)}

      ${renderCivicService(agent)}

      ${renderSkills(agent)}

      ${renderOutfit(agent)}

      ${renderNutrition(agent)}

      ${renderLeisure(agent)}

      ${renderSleep(agent)}

      ${renderAutonomy(agent)}

      ${renderEmotion(agent)}

      ${renderTimeManagement(agent)}

      ${renderRoutineRhythm(agent)}

      ${renderHousehold(agent)}

      ${renderActionOptions(agent)}

      ${renderReputation(agent)}

      ${renderMoodlets(agent)}

      ${renderStatusEffects(agent)}

      <div class="meter-grid">
        ${renderMeter("Health", agent.health, agent.health < 45 ? "danger" : "good")}
        ${renderMeter("Energy", agent.energy, agent.energy < 30 ? "warn" : "good")}
        ${renderMeter("Food", 100 - agent.hunger, agent.hunger > 75 ? "danger" : "warn")}
        ${renderMeter("Mood", agent.mood, agent.mood < 35 ? "warn" : "good")}
        ${renderMeter("Social", agent.social, agent.social < 28 ? "warn" : "good")}
        ${renderMeter("Comfort", agent.comfort, agent.comfort < 28 ? "warn" : "good")}
        ${renderMeter("Calm", 100 - agent.stress, agent.stress > 72 ? "danger" : agent.stress > 48 ? "warn" : "good")}
        ${renderMeter("Hygiene", agent.hygiene, agent.hygiene < 24 ? "warn" : "good")}
        ${renderMeter("Sleep", 100 - Math.max(agent.sleep.sleepDebt, agent.sleep.circadianFatigue), agent.sleep.sleepDebt > 78 || agent.sleep.circadianFatigue > 82 ? "danger" : agent.sleep.sleepDebt > 58 ? "warn" : "good")}
        ${renderMeter("Control", agent.autonomy.control, agent.autonomy.control < 28 || agent.autonomy.overwhelm > 82 ? "danger" : agent.autonomy.control < 50 ? "warn" : "good")}
        ${renderMeter("Time", 100 - agent.time.rush, agent.time.rush > 82 || agent.time.missedWindowsToday > 0 ? "danger" : agent.time.rush > 62 || agent.time.lateWindowsToday > 0 ? "warn" : "good")}
        ${renderMeter("Rhythm", agent.rhythm.momentum, agent.rhythm.drift > 78 ? "danger" : agent.rhythm.drift > 62 ? "warn" : "good")}
        ${renderMeter("Emotion", (agent.emotion.composure + agent.emotion.hope + agent.emotion.confidence) / 3, agent.emotion.irritation > 82 || agent.emotion.hope < 28 || agent.emotion.composure < 28 ? "danger" : agent.emotion.loneliness > 72 || agent.emotion.irritation > 62 ? "warn" : "good")}
      </div>

      <dl class="agent-stats">
        <div><dt>Credits</dt><dd>${agent.money}</dd></div>
        <div><dt>Savings</dt><dd>${agent.budget.savings}</dd></div>
        <div><dt>Credit</dt><dd>${agent.budget.creditScore}</dd></div>
        <div><dt>Rent Due</dt><dd>${agent.rentDue}</dd></div>
        <div><dt>Med Bill</dt><dd>${agent.medicalDebt}</dd></div>
        <div><dt>Basics Due</dt><dd>${agent.budget.livingCostDue}</dd></div>
        <div><dt>Budget</dt><dd>${agent.budget.spentToday}/${agent.budget.dailySpendLimit}</dd></div>
      </dl>

      ${renderFinanceLedger(agent)}

      ${renderObjectState(objectState)}

      ${renderDayArc(agent)}

      ${renderCommitments(agent)}

      ${renderPersonalNotices(agent)}

      ${renderEveningPlan(agent)}

      <div class="routine-strip" aria-label="Today">
        ${renderRoutinePill("Ate", agent.routine.ateToday)}
        ${renderRoutinePill("Washed", agent.routine.washedToday)}
        ${renderRoutinePill("Mail", agent.routine.checkedMailToday)}
        ${renderRoutinePill(agent.routine.sickLeaveToday ? "Sick" : "Worked", agent.routine.workedToday || agent.routine.sickLeaveToday)}
        ${renderRoutinePill("Service", agent.routine.maintenanceToday > 0)}
        ${renderRoutinePill("Social", agent.routine.socializedToday)}
        ${renderRoutinePill("Fun", agent.routine.recreationToday > 0)}
        ${renderRoutinePill("Agency", agent.routine.autonomyMomentsToday > 0)}
        ${renderRoutinePill("Time", agent.time.keptWindowsToday > 0 && agent.time.missedWindowsToday === 0)}
        ${renderRoutinePill("Rhythm", agent.rhythm.momentum > agent.rhythm.drift)}
        ${renderRoutinePill("Hope", agent.emotion.hope >= 52 && agent.emotion.irritation < 70)}
        ${renderRoutinePill("Calm", agent.routine.deescalationsToday > 0)}
        ${renderRoutinePill("Rent", agent.routine.paidRentToday || agent.rentDue === 0)}
        ${renderRoutinePill("Slept", agent.routine.sleptToday)}
      </div>

      ${
        agent.socialFocus
          ? `<div class="social-focus ${escapeHtml(agent.socialFocus.intent)}"><span>${escapeHtml(titleCase(agent.socialFocus.intent))}</span><b>${escapeHtml(agent.socialFocus.agentName)}</b><small>${escapeHtml(agent.socialFocus.reason)}</small></div>`
          : ""
      }

      ${renderSocialMoments(agent)}

      ${renderSocialCompass(agent)}

      ${renderRelationships(agent)}

      ${renderPlaceMemory(agent)}

      ${renderActivityMemory(agent)}

      ${renderMemoryTrail(agent)}

      <div class="agent-thought">
        <b>${escapeHtml(agent.goal)}</b>
        <span>${escapeHtml(agent.lastDecision)}</span>
        <span>${escapeHtml(agent.reflection)}</span>
        <small>Day plan: ${escapeHtml(agent.dayPlan.join(" -> "))}</small>
        <small>Plan: ${escapeHtml(agent.plan.join(" -> "))}</small>
      </div>
    </article>
  `;
};

const renderRosterBadge = (label: string, value: string, tone: "good" | "warn" | "bad" | "neutral") => `
  <span class="roster-badge ${tone}">
    <b>${escapeHtml(label)}</b>
    <small>${escapeHtml(value)}</small>
  </span>
`;

const renderRosterAgent = (agent: SimAgent, selectedAgentId: string | null) => {
  const workTone = agent.routine.workedToday || agent.routine.sickLeaveToday ? "good" : agent.money < 12 ? "bad" : "neutral";
  const workValue = agent.routine.maintenanceToday > 0 ? "served" : agent.routine.workedToday ? `+${agent.routine.earningsToday}` : agent.routine.sickLeaveToday ? "sick" : agent.money < 12 ? "need" : "open";
  const foodTone = agent.routine.mealsToday > 0 ? "good" : agent.hunger > 70 ? "bad" : "warn";
  const foodValue = agent.routine.mealsToday > 0 ? `${agent.routine.mealsToday}` : `${Math.round(agent.hunger)}`;
  const socialTone =
    agent.routine.conflictsToday > 0
      ? "bad"
      : agent.routine.bondsToday > 0 || agent.routine.deescalationsToday > 0
        ? "good"
        : agent.routine.socializedToday
          ? "warn"
          : "neutral";
  const socialValue =
    agent.routine.conflictsToday > 0
      ? `-${agent.routine.conflictsToday}`
      : agent.routine.bondsToday > 0
        ? `+${agent.routine.bondsToday}`
        : agent.routine.deescalationsToday > 0
          ? `calm ${agent.routine.deescalationsToday}`
        : agent.routine.socializedToday
          ? "out"
          : "quiet";
  return `
  <button class="agent-row ${agent.id === selectedAgentId ? "selected" : ""}" type="button" data-agent-id="${escapeHtml(agent.id)}">
    <span class="agent-dot" style="--agent-hue: ${agent.dna.appearanceHue}deg"></span>
    <span class="agent-row-main">
      <span class="agent-row-title">
        <strong>${escapeHtml(agent.name)}</strong>
        <small>${escapeHtml(agent.lifeProfile.archetype)} / ${escapeHtml(reputationRead(agent))} / ${escapeHtml(titleCase(agent.currentAction))}</small>
      </span>
      <span class="agent-row-badges">
        ${renderRosterBadge("Work", workValue, workTone)}
        ${renderRosterBadge("Food", foodValue, foodTone)}
        ${renderRosterBadge("Social", socialValue, socialTone)}
      </span>
    </span>
  </button>
`;
};

let latestSummary: AgentSummary | null = null;
let latestView: AppViewState = { selectedAgentId: null, cameraMode: "spectate" };
const markerNodes = new Map<string, HTMLElement>();

const renderAgents = (summary: AgentSummary, view: AppViewState) => {
  latestSummary = summary;
  latestView = view;
  const selected = summary.agents.find((agent) => agent.id === view.selectedAgentId) ?? null;
  const selectedObjectState =
    selected?.target ? (summary.objectStates.find((state) => state.structureId === selected.target?.structureId && state.actionPointId === selected.target?.actionPointId) ?? null) : null;
  const hydratedObjectState =
    selectedObjectState && selected?.target
      ? {
          ...selectedObjectState,
          hoursLabel: selectedObjectState.hoursLabel ?? selected.target.hoursLabel,
          openNow: selectedObjectState.openNow ?? selected.target.openNow
        }
      : selectedObjectState;
  agentCount.textContent = `Day ${summary.day} / ${summary.worldTime} / ${summary.phaseLabel} / ${summary.weather.label} / ${summary.agents.length} agent${summary.agents.length === 1 ? "" : "s"}`;
  cityPulse.innerHTML = renderCityPulse(summary.cityPulse, summary.civicNotices, summary.weather);
  selectedAgent.innerHTML = renderSelectedAgent(selected, hydratedObjectState);
  agentList.innerHTML =
    summary.agents.length > 0 ? summary.agents.map((agent) => renderRosterAgent(agent, view.selectedAgentId)).join("") : `<p>No active agents yet.</p>`;
  eventList.innerHTML =
    summary.events.length > 0
      ? summary.events
          .slice(0, 5)
          .map((event) => `<li class="event-${escapeHtml(event.tone)}"><time>${escapeHtml(event.worldTime)}</time>${escapeHtml(event.text)}</li>`)
          .join("")
      : `<li class="empty-event">Spawn an agent to start the sim.</li>`;
  emptyState.classList.toggle("visible", summary.agents.length === 0);
  previousAgent.disabled = summary.agents.length < 2;
  nextAgent.disabled = summary.agents.length < 2;
  spawnAgent.textContent = summary.agents.length === 0 ? "Spawn Agent" : "Spawn More";
  cameraMode.textContent = view.cameraMode === "free" ? "Spectate" : "Free Cam";
  document.body.dataset.cameraMode = view.cameraMode;
  document.body.dataset.hasAgents = summary.agents.length > 0 ? "true" : "false";
  prompt.classList.toggle("hidden", summary.agents.length === 0 || (view.cameraMode === "free" && document.pointerLockElement === canvas));
  prompt.textContent =
    view.cameraMode === "free"
      ? "Free camera: click world to look, WASD moves, F returns to spectate."
      : selected
        ? `Watching ${selected.name}. Q/E or buttons switch agents. F opens free camera.`
        : "Spawn an agent to start spectating.";
};

const createMarkerNode = () => {
  const marker = document.createElement("div");
  marker.className = "agent-world-marker";
  marker.innerHTML = `
    <span class="marker-name"></span>
    <b class="marker-action"></b>
    <span class="marker-intent"></span>
    <small class="marker-detail"></small>
    <i class="marker-progress"><em></em></i>
  `;
  agentWorldLabels.append(marker);
  return marker;
};

const renderWorldMarkers = (markers: AgentWorldMarker[]) => {
  const activeIds = new Set(markers.map((marker) => marker.id));
  for (const [id, node] of markerNodes.entries()) {
    if (!activeIds.has(id)) {
      node.remove();
      markerNodes.delete(id);
    }
  }

  for (const marker of markers) {
    const node = markerNodes.get(marker.id) ?? createMarkerNode();
    markerNodes.set(marker.id, node);
    node.hidden = !marker.visible;
    node.className = `agent-world-marker ${marker.variant} ${marker.selected ? "selected" : ""} ${marker.tone} ${marker.motiveKind ?? "none"} ${marker.socialKind ?? "none"}`;
    node.style.left = `${marker.xPercent.toFixed(2)}%`;
    node.style.top = `${marker.yPercent.toFixed(2)}%`;
    node.style.setProperty("--progress", `${Math.round(marker.progress * 100)}%`);
    node.querySelector(".marker-name")!.textContent = marker.name;
    node.querySelector(".marker-action")!.textContent = marker.actionLabel;
    node.querySelector(".marker-intent")!.textContent = marker.intentLabel;
    node.querySelector(".marker-detail")!.textContent = marker.detail;
  }
};

const app = new AgencyWorldApp({
  canvas,
  onStats: (text) => {
    worldStats.textContent = text;
  },
  onPointerLockChange: (locked) => {
    if (latestSummary) renderAgents(latestSummary, latestView);
    prompt.classList.toggle("hidden", locked && latestView.cameraMode === "free");
  },
  onDiagnostics: (text) => {
    diagnostics.textContent = text;
  },
  onAgentStatus: renderAgents,
  onWorldMarkers: renderWorldMarkers
});

worldTitle.textContent = "Agency";
app.generateFlatWorld("genesis-district", DEFAULT_FLAT_WORLD_OPTIONS);
app.setRenderDistance(128);
renderAgents(app.getAgentSummary(), app.getViewState());
app.start();

const updateWalletUi = () => {
  connectWallet.textContent = walletSessionToken ? "Wallet On" : "Dev Wallet";
};

const bootstrapFromApi = async () => {
  try {
    const state = await fetchJson<{ agents: ApiAgentView[]; events: Array<{ text: string }> }>("/api/world/bootstrap", {
      headers: apiHeaders()
    });
    for (const agent of state.agents) spawnApiAgentIntoViewer(agent);
    if (state.agents.length > 0) worldStats.textContent = `Loaded ${state.agents.length} launch-linked agent${state.agents.length === 1 ? "" : "s"} from Agency API.`;
  } catch {
    worldStats.textContent = "Agency API is offline; local spectator mode is running.";
  }
};

const connectDevWallet = async () => {
  const walletAddress = walletAddressInput.value.trim();
  if (!walletAddress) return;
  connectWallet.disabled = true;
  try {
    const nonce = await fetchJson<{ nonce: string; message: string; expiresAt: number }>("/api/auth/nonce", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ walletAddress })
    });
    const session = await fetchJson<{ token: string; walletAddress: string; expiresAt: number }>("/api/auth/verify", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ walletAddress, nonce: nonce.nonce, signature: `dev:${nonce.nonce}` })
    });
    walletSessionToken = session.token;
    localStorage.setItem("agency.walletSession", walletSessionToken);
    updateWalletUi();
    worldStats.textContent = `Dev wallet connected: ${walletLabel(session.walletAddress)}.`;
    await bootstrapFromApi();
  } catch (error) {
    worldStats.textContent = `Wallet login failed: ${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}`;
  } finally {
    connectWallet.disabled = false;
  }
};

const spawnMockPurchase = async () => {
  const walletAddress = walletAddressInput.value.trim();
  if (!walletAddress) return;
  mockPurchase.disabled = true;
  try {
    const response = await fetchJson<{
      event: {
        chainId: string;
        walletAddress: string;
        tokenMint: string;
        txSignature: string;
        logIndex: number;
        slot: number;
      };
      result: { agentCreated: boolean; agentId?: string; duplicate: boolean; reason: string };
      state: { agents: ApiAgentView[] };
    }>("/api/admin/mock-purchase", {
      method: "POST",
      headers: apiHeaders({ "x-admin-token": adminToken }),
      body: JSON.stringify({ walletAddress, tokenMint: "agency-dev-mint", tokenAmountDelta: 1 })
    });
    if (response.result.agentCreated) {
      const apiAgent = response.state.agents.find((agent) => agent.id === response.result.agentId);
      if (apiAgent) {
        spawnApiAgentIntoViewer(apiAgent);
      } else if (response.result.agentId && !apiSpawnedKeys.has(response.result.agentId)) {
        apiSpawnedKeys.add(response.result.agentId);
        app.spawnAgentFromSeed({
          chainId: response.event.chainId,
          walletAddress: response.event.walletAddress,
          tokenMint: response.event.tokenMint,
          txHash: response.event.txSignature,
          logIndex: response.event.logIndex,
          slot: response.event.slot,
          seasonId: "genesis",
          publicGenesisSalt: "agency-api-event"
        });
      }
    }
    worldStats.textContent = response.result.reason;
  } catch (error) {
    worldStats.textContent = `Mock purchase failed: ${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}`;
  } finally {
    mockPurchase.disabled = false;
  }
};

const spawn = () => {
  const agent = app.spawnAgent();
  if (!agent) return;
};

updateWalletUi();
void bootstrapFromApi();
connectWallet.addEventListener("click", () => void connectDevWallet());
mockPurchase.addEventListener("click", () => void spawnMockPurchase());
spawnAgent.addEventListener("click", spawn);
spawnAgentEmpty.addEventListener("click", spawn);
previousAgent.addEventListener("click", () => app.selectNextAgent(-1));
nextAgent.addEventListener("click", () => app.selectNextAgent(1));
cameraMode.addEventListener("click", () => app.toggleFreeCamera());
agentList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button[data-agent-id]") as HTMLButtonElement | null;
  const id = button?.dataset.agentId;
  if (id) app.selectAgent(id);
});
