import { ethers } from 'ethers';
import { config } from '../config.js';

// READ-ONLY treasury access. We read the public BNB balance of a public
// address over a public BSC RPC. No private keys are ever created, held, or
// written anywhere in this backend.

let provider = null;

function getProvider() {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.bscRpcUrl);
  }
  return provider;
}

/**
 * Read the treasury BNB balance. Returns { ok, balanceBnb }.
 * Never throws; on any failure returns ok:false and balanceBnb:0.
 */
export async function getTreasuryBalance(address) {
  const addr = address || config.treasuryAddress;
  if (!addr || !ethers.isAddress(addr)) {
    return { ok: false, balanceBnb: 0, reason: 'no valid treasury address configured' };
  }
  try {
    const wei = await getProvider().getBalance(addr);
    const balanceBnb = Number(ethers.formatEther(wei));
    return { ok: true, balanceBnb };
  } catch (err) {
    return { ok: false, balanceBnb: 0, reason: err?.message || String(err) };
  }
}

/**
 * The life model.
 *
 * treasuryHealth is a 0..1 figure that answers "how full and how safe is the
 * treasury right now", combining how much runway the balance buys against the
 * burn rate (hoursRemaining) with how the balance compares to a healthy
 * baseline.
 *
 *   burnRate            = BURN_RATE_BNB_PER_HOUR            (BNB per hour)
 *   hoursRemaining      = balanceBnb / burnRate             (runway in hours)
 *   cyclesRemaining     = hoursRemaining * 3600 / cycleSeconds
 *
 *   baselineHealthyHours = healthyBaselineBnb / burnRate
 *   runwayHealth        = clamp01(hoursRemaining / baselineHealthyHours)
 *   balanceHealth       = clamp01(balanceBnb / healthyBaselineBnb)
 *   treasuryHealth      = clamp01( 0.5 * runwayHealth + 0.5 * balanceHealth )
 *
 * Because both inputs are driven by the same balance here, treasuryHealth
 * reduces to clamp01(balanceBnb / healthyBaselineBnb), but keeping both terms
 * makes the model easy to retune (e.g. a dynamic burn rate later).
 *
 * Status is driven purely by hoursRemaining against the configured thresholds:
 *   hoursRemaining <= deadHours   -> DEAD
 *   hoursRemaining <= dyingHours  -> DYING
 *   otherwise                     -> ALIVE
 */
export function computeLifeModel(balanceBnb, ageHours = 0) {
  const {
    burnRateBnbPerHour,
    healthyBaselineBnb,
    cycleSeconds,
    dyingHours,
    deadHours,
    birthGraceHours = 0,
  } = config.sim;

  const burnRate = burnRateBnbPerHour > 0 ? burnRateBnbPerHour : 0.0001;
  const walletHours = balanceBnb / burnRate;

  // Birth energy: innate runway a freshly hatched worm has, decaying with age.
  const graceLeft = Math.max(0, birthGraceHours - Math.max(0, ageHours));

  // Effective runway drives status and the displayed "time left".
  const hoursRemaining = walletHours + graceLeft;
  const cyclesRemaining = (hoursRemaining * 3600) / cycleSeconds;

  const baselineHealthyHours = healthyBaselineBnb / burnRate;
  const runwayHealth = clamp01(hoursRemaining / Math.max(baselineHealthyHours, 0.0001));
  const balanceHealth = clamp01(balanceBnb / healthyBaselineBnb);
  const walletComposite = clamp01(0.5 * runwayHealth + 0.5 * balanceHealth);

  // While birth energy lasts it gives a small, fading health floor so a cold
  // new wallet does not read as near death. Once it is gone, health is purely
  // the wallet.
  const graceHealth = birthGraceHours > 0 ? clamp01(graceLeft / birthGraceHours) * 0.5 : 0;
  const treasuryHealth = clamp01(Math.max(walletComposite, graceHealth));

  let status;
  if (hoursRemaining <= deadHours) status = 'DEAD';
  else if (hoursRemaining <= dyingHours) status = 'DYING';
  else status = 'ALIVE';

  return {
    burnRateBnbPerHour: burnRate,
    walletHours,
    hoursRemaining,
    cyclesRemaining,
    treasuryHealth,
    status,
  };
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
