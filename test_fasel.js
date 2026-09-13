import { http } from "./src/utils/http.js";

async function main() {
  const referer = "https://www.fasel-hd.co/movies/1-%d9%81%d9%8a%d9%84%d9%85-thor-love-thunder-2022-%d9%85%d8%aa%d8%b1%d8%ac%d9%85-y";
  const playerUrl = "https://www.fasel-hd.co/video_player?player_token=WVNwNGxaZzNLMEJ4ZkUxc29hNnV4UlVkOWd1cmNPSVd2Sm80L2pZckxneERoTXRxR1phNDRGWVl4U25oUTJHVkxEYi9rd1FnVm4zc2Urcld3K2Z1QmhiaGJrY3UyU3A5MlNJY3daT05pTDNZdlF0NDRJN0doZkFNNE5CMTFrb2VyekJYY2M1YlBvOXZzbW1NYkNDZTBVeGZzZVpPR2N6THczL3ZWTUJpYXV4QXVwdUhDbjdZa3ZJTmZpZUhpcXZudGNTMnNRZnc4NjAwYnNnSXB3cG84TVVNSWlBY2ZXdTllRStWQkRmZDJ6Zz06Ov2x2Db3Ez85cwGlXVOblbg%3D";
  
  const res = await http.get(playerUrl, { headers: { "Referer": referer } });

  res.$("script").each((i, s) => {
    const src = res.$(s).attr("src");
    console.log(`Script ${i}: src=${src}`);
    if (!src) {
      const html = res.$(s).html() || "";
      console.log(`  Inline len=${html.length}, snippet=${html.slice(0, 150)}`);
    }
  });
}

main().catch(console.error);
