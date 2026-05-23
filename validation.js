/**
 * Validation rules (documented):
 *
 *  name  — required, non-empty string (after trim)
 *  sku   — required, non-empty string (after trim), unique across all products
 *  URLs  — must start with http:// or https://
 *          max length: 2048 characters
 *          max 20 URLs per array per request
 */

const MAX_URL_LENGTH  = 2048;
const MAX_URLS_PER_ARRAY = 20;

function isValidUrl(str) {
  if (typeof str !== 'string') return false;
  if (str.length > MAX_URL_LENGTH) return false;
  return str.startsWith('http://') || str.startsWith('https://');
}

function validateUrlArray(arr, fieldName) {
  if (!Array.isArray(arr)) {
    return `${fieldName} must be an array`;
  }
  if (arr.length > MAX_URLS_PER_ARRAY) {
    return `${fieldName} may contain at most ${MAX_URLS_PER_ARRAY} URLs per request`;
  }
  for (let i = 0; i < arr.length; i++) {
    if (!isValidUrl(arr[i])) {
      return `${fieldName}[${i}] is invalid — must be http:// or https:// and ≤ ${MAX_URL_LENGTH} chars`;
    }
  }
  return null; // valid
}

/**
 * Validate POST /products body.
 * Returns { errors: string[] }
 */
function validateCreateProduct({ name, sku, image_urls, video_urls }) {
  const errors = [];

  if (!name || typeof name !== 'string' || name.trim() === '') {
    errors.push('name is required and must be a non-empty string');
  }
  if (!sku || typeof sku !== 'string' || sku.trim() === '') {
    errors.push('sku is required and must be a non-empty string');
  }

  if (image_urls !== undefined) {
    const err = validateUrlArray(image_urls, 'image_urls');
    if (err) errors.push(err);
  }
  if (video_urls !== undefined) {
    const err = validateUrlArray(video_urls, 'video_urls');
    if (err) errors.push(err);
  }

  return errors;
}

/**
 * Validate POST /products/:id/media body.
 * Returns { errors: string[] }
 */
function validateAddMedia({ image_urls, video_urls }) {
  const errors = [];

  const hasImages = Array.isArray(image_urls) && image_urls.length > 0;
  const hasVideos = Array.isArray(video_urls) && video_urls.length > 0;

  if (!hasImages && !hasVideos) {
    errors.push('at least one of image_urls or video_urls must be provided and non-empty');
    return errors;
  }

  if (image_urls !== undefined) {
    const err = validateUrlArray(image_urls, 'image_urls');
    if (err) errors.push(err);
  }
  if (video_urls !== undefined) {
    const err = validateUrlArray(video_urls, 'video_urls');
    if (err) errors.push(err);
  }

  return errors;
}

module.exports = { validateCreateProduct, validateAddMedia };
