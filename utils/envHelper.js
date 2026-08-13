// utils/envHelper.js — helper to validate environment variable channel/guild/client IDs
function getValidId(val, fallback) {
  if (val && typeof val === 'string' && !val.includes('your_') && /^\d+$/.test(val.trim())) {
    return val.trim();
  }
  return fallback;
}

module.exports = { getValidId };
