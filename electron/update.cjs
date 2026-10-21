const OWNER = "timmiskiewicz-lab";
const REPO = "fc27poor";
const API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${OWNER}/${REPO}/releases/download/`;
const PAGE_PREFIX = `https://github.com/${OWNER}/${REPO}/releases/tag/`;

function parseVersion(value) {
  return String(value ?? "")
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function isNewer(remote, local) {
  const next = parseVersion(remote);
  const have = parseVersion(local);
  const count = Math.max(next.length, have.length);
  for (let i = 0; i < count; i += 1) {
    const diff = (next[i] || 0) - (have[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

function notesOf(body) {
  return String(body || "")
    .replace(/[#>*_`[\]]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .slice(0, 280);
}

function pickAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const setup = assets.find((asset) => {
    const name = String(asset?.name || "");
    const url = String(asset?.browser_download_url || "");
    return /setup.*\.exe$/i.test(name) && url.startsWith(DOWNLOAD_PREFIX);
  });
  if (!setup) return null;
  const version = String(release.tag_name || "").replace(/^v/i, "");
  if (!version) return null;
  return {
    version,
    notes: notesOf(release.body),
    url: setup.browser_download_url,
    name: setup.name,
    page: `${PAGE_PREFIX}v${version}`,
  };
}

module.exports = { API, DOWNLOAD_PREFIX, PAGE_PREFIX, isNewer, pickAsset, parseVersion };
