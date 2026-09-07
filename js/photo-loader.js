/* ============================================
   Bartop Arcade - Photo Loader
   ============================================
   Loads stock photos from local assets/photos/
   (downloaded from Picsum/Unsplash via
   scripts/download-photos.sh). Local files
   avoid CORS restrictions (so canvas can do
   getImageData) and make loads instant.
   ============================================ */

const PHOTO_BASE = 'assets/photos';
const DEFAULT_TIMEOUT_MS = 10000;

// Curated photo categories with local file lists.
// Each entry maps to a directory of files downloaded by the shell script.
// Files are named: <category>__<seed>.jpg
export const CATEGORIES = [
  { id: 'animals',  files: ['cat','dog','puppy','fox','panda','tiger','bird','rabbit','wolf','bear','horse','elephant'] },
  { id: 'food',     files: ['pizza','sushi','burger','coffee','cake','pasta','fruit','bread','salad','wine'] },
  { id: 'nature',   files: ['mountain','forest','ocean','sunset','lake','desert','waterfall','beach','autumn','river'] },
  { id: 'cities',   files: ['paris','tokyo','newyork','london','rome','barcelona','dubai','singapore','sydney','istanbul'] },
  { id: 'objects',  files: ['vintage','camera','book','clock','lamp','phone','guitar','bicycle','motorcycle','shoes'] },
  { id: 'flowers',  files: ['rose','sunflower','tulip','lavender','orchid','daisy','cherry','lily','jasmine','peony'] },
  { id: 'vehicles', files: ['classic-car','train','plane','boat','sailboat','helicopter','truck','scooter','jeep','submarine'] },
  { id: 'space',    files: ['galaxy','nebula','moon','mars','stars','milky-way','astronaut','rocket','eclipse','saturn'] },
  { id: 'random',   files: ['surprise1','surprise2','surprise3','surprise4','surprise5'] },
  { id: 'abstract', files: ['color','texture','pattern','wave','smoke','glass','metal','water','light','shadow'] },
  // User-purchased stock photos (full license: use in commercial projects, including video games).
  // See README for attribution.
  { id: 'purchased', files: ['sierra-mountains','tennis-girls'] },
];

// ── Image cache ──
const cache = new Map();   // key: filename -> HTMLImageElement
const pending = new Map(); // de-dupe in-flight requests

function loadOne(filename, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (cache.has(filename)) return Promise.resolve(cache.get(filename));
  if (pending.has(filename)) return pending.get(filename);

  const p = new Promise((resolve, reject) => {
    const img = new Image();
    let timer;
    timer = setTimeout(() => {
      pending.delete(filename);
      reject(new Error(`timeout: ${filename}`));
    }, timeoutMs);

    img.addEventListener('load', () => {
      clearTimeout(timer);
      cache.set(filename, img);
      pending.delete(filename);
      resolve(img);
    }, { once: true });
    img.addEventListener('error', () => {
      clearTimeout(timer);
      pending.delete(filename);
      reject(new Error(`failed: ${filename}`));
    }, { once: true });

    img.src = `${PHOTO_BASE}/${filename}.jpg`;
  });

  pending.set(filename, p);
  return p;
}

/** Load one or more photos by category and seed name. Returns HTMLImageElement[]. */
export async function loadPhotosByCategory(categoryId, count = 1) {
  const cat = CATEGORIES.find(c => c.id === categoryId) || CATEGORIES[0];
  const shuffled = [...cat.files].sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, count);
  const settled = await Promise.allSettled(picks.map(name => loadOne(`${cat.id}__${name}`)));
  return settled.map(s => s.status === 'fulfilled' ? s.value : null);
}

/** Pick a random category id. */
export function randomCategoryId() {
  return CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)].id;
}

/** Clear cache (debug / memory pressure). */
export function clearCache() {
  cache.clear();
  pending.clear();
}

/** Get total photo count across all categories. */
export function totalPhotoCount() {
  return CATEGORIES.reduce((sum, c) => sum + c.files.length, 0);
}
