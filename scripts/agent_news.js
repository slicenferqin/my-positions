
import https from 'https';

// Usage: node scripts/agent_news.js <fund_code_1> <fund_code_2> ...
// Example: node scripts/agent_news.js 005827 012414

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/agent_news.js <fund_code_1> [fund_code_2] ...');
  process.exit(1);
}

const FUND_CODES = args;

// --- API Helpers ---

async function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...options.headers
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Status ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// --- Services ---

async function getFundPortfolio(code) {
  const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0`;
  try {
    const data = await fetchJSON(url);
    if (data && data.Datas && data.Datas.fundStocks) {
      return data.Datas.fundStocks.map(s => ({
        code: s.GPDM,
        name: s.GPJC,
        percent: s.JZBL
      }));
    }
    return [];
  } catch (e) {
    console.error(`Error fetching portfolio for ${code}:`, e.message);
    return [];
  }
}

async function getNews() {
  const params = new URLSearchParams({
    app: 'CailianpressWeb',
    os: 'web',
    refresh_type: '1',
    order: '1',
    rn: '50', // Get 50 items
    sv: '8.4.6'
  });
  const url = `https://www.cls.cn/nodeapi/telegraphList?${params.toString()}`;
  try {
    const data = await fetchJSON(url, {
      headers: {
        'Referer': 'https://www.cls.cn/telegraph'
      }
    });
    if (data && data.data && data.data.roll_data) {
      return data.data.roll_data;
    }
    return [];
  } catch (e) {
    console.error('Error fetching news:', e.message);
    return [];
  }
}

// --- Main ---

async function main() {
  // 1. Fetch Holdings
  console.error('Fetching holdings...');
  const holdingsMap = new Map(); // code -> name
  const fundHoldings = {};

  for (const code of FUND_CODES) {
    const stocks = await getFundPortfolio(code);
    fundHoldings[code] = stocks.map(s => s.name);
    stocks.forEach(s => holdingsMap.set(s.name, s.code));
  }

  const allStocks = Array.from(holdingsMap.keys());
  console.error(`Found ${allStocks.length} unique stocks across ${FUND_CODES.length} funds.`);

  // 2. Fetch News
  console.error('Fetching news...');
  const newsItems = await getNews();
  console.error(`Fetched ${newsItems.length} news items.`);

  // 3. Filter News (Simple keyword match)
  const relatedNews = newsItems.filter(item => {
    const text = (item.title + item.content).toLowerCase();
    return allStocks.some(stock => text.includes(stock.toLowerCase()));
  });

  // 4. Generate Prompt
  const prompt = `
你是一位专业的金融分析师。我持有以下基金，它们的前十大重仓股包含：
${allStocks.join('、')}

最近市场上有以下相关快讯（已筛选与我持仓相关的）：
${relatedNews.length > 0 ? relatedNews.map((n, i) => `
${i + 1}. 【${n.title || '快讯'}】 ${new Date(n.ctime * 1000).toLocaleString()}
${n.content}
`).join('\n') : '（暂无直接提及持仓股的快讯，请分析下方的一般市场重要快讯）'}

${relatedNews.length === 0 ? `
一般市场重要快讯（Top 10）：
${newsItems.slice(0, 10).map((n, i) => `${i+1}. ${n.content.substring(0, 100)}...`).join('\n')}
` : ''}

请根据上述信息：
1. 分析这些新闻对我的持仓（具体到股票或板块）有何具体影响（利好/利空/中性）。
2. 如果有重大利好或风险，请特别提示。
3. 给出简要的操作建议（如继续持有、关注风险等）。
`;

  console.log(prompt);
}

main().catch(console.error);
