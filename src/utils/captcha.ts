import { Logger } from './logger.js';

const logger = new Logger('CaptchaDetector');

/**
 * Detects whether an HTML response or HTTP status represents a blocking captcha challenge
 * (Cloudflare Turnstile, hCaptcha, reCAPTCHA, etc.) without a playable media element.
 */
export function isCaptchaChallenge(html?: string, status?: number): boolean {
  if (status === 403 || status === 503) {
    if (!html) return true;
    const lower = html.toLowerCase();
    if (
      lower.includes('cloudflare') ||
      lower.includes('turnstile') ||
      lower.includes('challenge') ||
      lower.includes('captcha') ||
      lower.includes('access denied') ||
      lower.includes('just a moment')
    ) {
      return true;
    }
  }

  if (!html) return false;
  const lower = html.toLowerCase();

  // If the page already has video streams, packed players, or known embed players, it's not a blocking challenge
  if (
    lower.includes('.m3u8') ||
    lower.includes('eval(function(p,a,c,k,e,d)') ||
    lower.includes('eval(function(p, a, c, k, e, d)') ||
    lower.includes('jwplayer(') ||
    lower.includes('<video') ||
    lower.includes('embed-') ||
    lower.includes('ukrcdn.') ||
    lower.includes('miravd.') ||
    lower.includes('mwdy.') ||
    lower.includes('vidoba.') ||
    lower.includes('govid.')
  ) {
    return false;
  }

  // Real Cloudflare Turnstile or Managed Challenge
  if (
    lower.includes('<title>just a moment...</title>') ||
    lower.includes('attention required! | cloudflare') ||
    lower.includes('id="challenge-form"') ||
    lower.includes('id="challenge-running"') ||
    lower.includes('class="cf-turnstile"') ||
    (lower.includes('data-sitekey') && (lower.includes('turnstile') || lower.includes('hcaptcha')))
  ) {
    logger.debug('Detected Cloudflare Turnstile / Managed challenge page');
    return true;
  }

  // hCaptcha or reCAPTCHA blocking forms
  if (
    (lower.includes('class="h-captcha"') || lower.includes('hcaptcha.com/1/api.js') || lower.includes('google.com/recaptcha/api.js')) &&
    (lower.includes('submit') || lower.includes('verify'))
  ) {
    logger.debug('Detected hCaptcha / reCAPTCHA challenge page');
    return true;
  }

  return false;
}
