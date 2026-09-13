import { http, MOBILE_USER_AGENT } from './utils/http.js';

async function inspectEgydeadCa() {
  const res = await http.get('https://egydead.ca/', {
    headers: { 'User-Agent': MOBILE_USER_AGENT },
  });

  console.log('Status:', res.status, 'Title:', res.$('title').text().trim());

  // Check nav links
  console.log('--- Nav Links ---');
  res.$('nav a, header a, .menu a, a').each((_, el) => {
    const text = res.$(el).text().trim();
    const href = res.$(el).attr('href');
    if (href && (href.includes('cat') || href.includes('movie') || href.includes('series') || text.includes('افلام') || text.includes('مسلسلات'))) {
      console.log(`Link: "${text}" -> ${href}`);
    }
  });

  // Check movie/series cards
  console.log('--- Sample Item Cards ---');
  const selectors = [
    'div.MovieBlock',
    'div.PostBlock',
    'div.moviesList div.item',
    '.block-item',
    '.movie-item',
    '.post-item',
    'article',
    'a[href*="/movie/"]',
    'a[href*="/series/"]',
  ];

  for (const s of selectors) {
    const matches = res.$(s);
    console.log(`Selector "${s}": count = ${matches.length}`);
  }

  // Find all links that look like movies or series
  const itemLinks: { href: string; title: string }[] = [];
  res.$('a').each((_, el) => {
    const href = res.$(el).attr('href') || '';
    const title = res.$(el).text().trim() || res.$(el).attr('title') || '';
    if ((href.includes('/movie') || href.includes('/series') || href.includes('/film')) && title.length > 3) {
      if (!itemLinks.some(x => x.href === href)) {
        itemLinks.push({ href, title });
      }
    }
  });

  console.log('Found item links:', itemLinks.slice(0, 10));
}

inspectEgydeadCa();
