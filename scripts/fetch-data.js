#!/usr/bin/env node
/**
 * 黄金看板数据采集脚本
 * 从 FRED / Yahoo Finance 等源抓取数据，生成静态 JSON
 * 
 * 用法: node scripts/fetch-data.js
 * 环境变量: FRED_API_KEY (必需)
 */

const fs = require('fs');
const path = require('path');

// ========== 配置 ==========
const FRED_API_KEY = process.env.FRED_API_KEY;
const DATA_DIR = path.join(__dirname, '..', 'data');

// FRED 数据系列配置
const FRED_SERIES = {
  // 机会成本
  'DFII10': { name_zh: '10年TIPS实际收益率', unit: '%', section: '机会成本', direction: 'negative' },
  'DFII5': { name_zh: '5年TIPS实际收益率', unit: '%', section: '机会成本', direction: 'negative' },
  'T10YIE': { name_zh: '10年盈亏平衡通胀', unit: '%', section: '机会成本', direction: 'positive' },
  
  // 美元与流动性
  'DTWEXBGS': { name_zh: '美元指数', unit: '指数', section: '美元与流动性', direction: 'negative' },
  
  // 通胀与增长
  'PCEPI': { name_zh: 'PCE物价指数', unit: '指数', section: '通胀与增长', direction: 'positive' },
  'IPMAN': { name_zh: '工业生产指数', unit: '指数', section: '通胀与增长', direction: 'neutral' },
  'UNRATE': { name_zh: '失业率', unit: '%', section: '通胀与增长', direction: 'negative' },
  
  // 财政与信用
  'GFDEBTN': { name_zh: '联邦债务总额', unit: '十亿美元', section: '财政与信用', direction: 'positive' },
  'GFDEGDQ188S': { name_zh: '债务/GDP', unit: '%', section: '财政与信用', direction: 'positive' },
  'FYFSGDA188S': { name_zh: '财政赤字/GDP', unit: '%', section: '财政与信用', direction: 'positive' },
  'FEDFUNDS': { name_zh: '联邦基金利率', unit: '%', section: '机会成本', direction: 'negative' },
  
  // 风险温度
  'GVZCLS': { name_zh: '黄金波动率', unit: '%', section: '风险温度', direction: 'negative' },
  
  // 汇率
  'DEXCHUS': { name_zh: '美元兑人民币', unit: '汇率', section: '美元与流动性', direction: 'negative' },
};

// ========== 工具函数 ==========
async function fetchFREDSeries(seriesId) {
  if (!FRED_API_KEY) {
    console.error(`⚠️  FRED_API_KEY 未设置，跳过 ${seriesId}`);
    return null;
  }
  
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 365 * 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 10年数据
  
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&observation_start=${startDate}&observation_end=${endDate}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    if (data.error_code) throw new Error(data.error_message);
    
    return data.observations
      .filter(obs => obs.value !== '.')
      .map(obs => ({
        date: obs.date,
        value: parseFloat(obs.value)
      }));
  } catch (error) {
    console.error(`❌ FRED ${seriesId} 获取失败:`, error.message);
    return null;
  }
}

function calculateChanges(series) {
  if (!series || series.length < 2) return {};
  
  const latest = series[series.length - 1];
  const latestValue = latest.value;
  
  // 计算不同周期的变化
  const changes = {};
  
  // 5天
  const day5 = series.find(s => {
    const diff = (new Date(latest.date) - new Date(s.date)) / (1000 * 60 * 60 * 24);
    return diff >= 4 && diff <= 6;
  });
  if (day5) changes['5d'] = latestValue - day5.value;
  
  // 20天
  const day20 = series.find(s => {
    const diff = (new Date(latest.date) - new Date(s.date)) / (1000 * 60 * 60 * 24);
    return diff >= 18 && diff <= 22;
  });
  if (day20) changes['20d'] = latestValue - day20.value;
  
  // 3个月
  const month3 = series.find(s => {
    const diff = (new Date(latest.date) - new Date(s.date)) / (1000 * 60 * 60 * 24);
    return diff >= 85 && diff <= 95;
  });
  if (month3) changes['3m'] = latestValue - month3.value;
  
  // 同比（约365天）
  const yearAgo = series.find(s => {
    const diff = (new Date(latest.date) - new Date(s.date)) / (1000 * 60 * 60 * 24);
    return diff >= 360 && diff <= 370;
  });
  if (yearAgo) changes['yoy'] = latestValue - yearAgo.value;
  
  return changes;
}

function calculatePercentiles(series) {
  if (!series || series.length < 30) return {};
  
  const latestValue = series[series.length - 1].value;
  
  // 1年百分位
  const year1Data = series.slice(-252); // 约252个交易日
  const year1Sorted = year1Data.map(s => s.value).sort((a, b) => a - b);
  const year1Rank = year1Sorted.findIndex(v => v >= latestValue);
  const percentile1y = Math.round((year1Rank / year1Sorted.length) * 100);
  
  // 3年百分位
  const year3Data = series.slice(-756);
  const year3Sorted = year3Data.map(s => s.value).sort((a, b) => a - b);
  const year3Rank = year3Sorted.findIndex(v => v >= latestValue);
  const percentile3y = Math.round((year3Rank / year3Sorted.length) * 100);
  
  return {
    '1y': percentile1y,
    '3y': percentile3y
  };
}

async function generateIndicatorJSON(seriesId, config) {
  console.log(`📊 获取 ${config.name_zh} (${seriesId})...`);
  
  const series = await fetchFREDSeries(seriesId);
  if (!series) return null;
  
  const latest = series[series.length - 1];
  const changes = calculateChanges(series);
  const percentiles = calculatePercentiles(series);
  
  return {
    id: seriesId,
    name_zh: config.name_zh,
    name_en: seriesId,
    unit: config.unit,
    section: config.section,
    direction: config.direction,
    thresholds: null,
    
    // ========== 数据来源标注 ==========
    metadata: {
      source: 'FRED (Federal Reserve Economic Data)',
      source_url: 'https://fred.stlouisfed.org',
      series_id: seriesId,
      api_endpoint: `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}`,
      fred_page: `https://fred.stlouisfed.org/series/${seriesId}`,
      description: '美联储圣路易斯联储银行官方经济数据',
      update_frequency: '根据各指标发布周期更新（通常为日/周/月）'
    },
    
    updated: new Date().toISOString().split('T')[0],
    latest: {
      date: latest.date,
      value: latest.value
    },
    changes,
    percentiles,
    series
  };
}

// ========== 黄金价格（Yahoo Finance）==========

/**
 * 从 Yahoo Finance 获取黄金相关数据
 * @param {string} symbol - 股票代码（GC=F 或 GLD）
 * @param {Object} config - 配置信息
 */
async function fetchGoldData(symbol, config) {
  console.log(`📊 获取 ${config.name_zh} (${symbol}) from Yahoo Finance...`);
  
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 365 * 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  try {
    // Yahoo Finance API
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${Math.floor(new Date(startDate).getTime()/1000)}&period2=${Math.floor(new Date(endDate).getTime()/1000)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
      throw new Error('无法获取数据');
    }
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];
    
    if (!timestamps || !quotes || !quotes.close) {
      throw new Error('数据格式错误');
    }
    
    // 转换为我们的格式
    const series = timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      value: quotes.close[i]
    })).filter(item => item.value !== null && item.value !== undefined);
    
    if (series.length === 0) throw new Error('无有效数据');
    
    // 去重（保留每天最后一条）
    const uniqueSeries = [];
    const seenDates = new Set();
    for (const item of series.reverse()) {
      if (!seenDates.has(item.date)) {
        seenDates.add(item.date);
        uniqueSeries.push(item);
      }
    }
    uniqueSeries.reverse();
    
    const latest = uniqueSeries[uniqueSeries.length - 1];
    const changes = calculateChanges(uniqueSeries);
    const percentiles = calculatePercentiles(uniqueSeries);
    
    console.log(`  ✅ 获取成功，最新价格: $${latest.value.toFixed(2)}`);
    
    return {
      id: config.id,
      name_zh: config.name_zh,
      name_en: config.name_en,
      unit: config.unit,
      section: '参考价格',
      direction: null,
      thresholds: null,
      
      // ========== 数据来源标注 ==========
      metadata: {
        source: 'Yahoo Finance',
        source_url: 'https://finance.yahoo.com',
        symbol: symbol,
        api_endpoint: `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`,
        description: config.description,
        update_frequency: '每日收盘后更新',
        notes: config.notes
      },
      
      updated: new Date().toISOString().split('T')[0],
      latest: {
        date: latest.date,
        value: latest.value
      },
      changes,
      percentiles,
      series: uniqueSeries
    };
  } catch (error) {
    console.error(`❌ Yahoo Finance ${symbol} 获取失败:`, error.message);
    return null;
  }
}

async function fetchGoldPrice() {
  // 保留旧函数名以兼容
  return fetchGoldData('GC=F', {
    id: 'GOLD_USD',
    name_zh: '黄金期货',
    name_en: 'Gold Futures',
    unit: '美元/盎司',
    description: '纽约商品交易所(COMEX)黄金期货连续合约',
    notes: '期货价格，通常略高于现货价格（升水）'
  });
}

// ========== 主函数 ==========
async function main() {
  console.log('🚀 开始采集数据...\n');
  
  // 确保数据目录存在
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  const results = {
    success: [],
    failed: []
  };
  
  // 1. 获取黄金期货 (GC=F)
  const goldFuturesData = await fetchGoldData('GC=F', {
    id: 'GOLD_FUTURES',
    name_zh: '黄金期货',
    name_en: 'Gold Futures (GC=F)',
    unit: '美元/盎司',
    description: '纽约商品交易所(COMEX)黄金期货连续合约',
    notes: '期货价格反映市场对未来黄金价格的预期，通常略高于现货价格（升水）'
  });
  
  if (goldFuturesData) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'GOLD_FUTURES.json'),
      JSON.stringify(goldFuturesData, null, 2)
    );
    results.success.push('GOLD_FUTURES');
    console.log('✅ GOLD_FUTURES (GC=F) 已保存\n');
  } else {
    results.failed.push('GOLD_FUTURES');
  }
  
  // 2. 获取黄金ETF (GLD)
  const goldETFData = await fetchGoldData('GLD', {
    id: 'GOLD_ETF',
    name_zh: '黄金ETF',
    name_en: 'SPDR Gold Shares (GLD)',
    unit: '美元',
    description: 'SPDR黄金信托ETF，追踪黄金现货价格',
    notes: 'ETF价格约为黄金现货价格的1/10（1股GLD ≈ 0.1盎司黄金）'
  });
  
  if (goldETFData) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'GOLD_ETF.json'),
      JSON.stringify(goldETFData, null, 2)
    );
    results.success.push('GOLD_ETF');
    console.log('✅ GOLD_ETF (GLD) 已保存\n');
  } else {
    results.failed.push('GOLD_ETF');
  }
  
  // 3. 兼容旧版本：GOLD_USD.json = 黄金期货数据
  if (goldFuturesData) {
    const legacyData = {
      ...goldFuturesData,
      id: 'GOLD_USD',
      name_zh: '国际金价',
      metadata: {
        ...goldFuturesData.metadata,
        notes: '⚠️ 此字段已弃用，建议使用 GOLD_FUTURES (期货) 或 GOLD_ETF (现货代理)'
      }
    };
    fs.writeFileSync(
      path.join(DATA_DIR, 'GOLD_USD.json'),
      JSON.stringify(legacyData, null, 2)
    );
    results.success.push('GOLD_USD');
    console.log('✅ GOLD_USD (兼容旧版) 已保存\n');
  }
  
  // 4. 获取所有 FRED 指标
  for (const [seriesId, config] of Object.entries(FRED_SERIES)) {
    const data = await generateIndicatorJSON(seriesId, config);
    
    if (data) {
      fs.writeFileSync(
        path.join(DATA_DIR, `${seriesId}.json`),
        JSON.stringify(data, null, 2)
      );
      results.success.push(seriesId);
      console.log(`✅ ${seriesId} 已保存\n`);
    } else {
      results.failed.push(seriesId);
    }
    
    // 避免触发 FRED 限流
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // 5. 生成汇总文件
  const allIndicators = {
    updated: new Date().toISOString(),
    indicators: [...results.success, ...results.failed].map(id => {
      const config = FRED_SERIES[id] || { name_zh: id, unit: '', section: '参考价格' };
      return {
        id,
        name_zh: config.name_zh,
        status: results.success.includes(id) ? 'success' : 'failed'
      };
    })
  };
  
  fs.writeFileSync(
    path.join(DATA_DIR, 'all_indicators.json'),
    JSON.stringify(allIndicators, null, 2)
  );
  
  // 6. 输出汇总
  console.log('\n' + '='.repeat(50));
  console.log('📊 数据采集完成');
  console.log('='.repeat(50));
  console.log(`✅ 成功: ${results.success.length} 个`);
  console.log(`❌ 失败: ${results.failed.length} 个`);
  
  if (results.failed.length > 0) {
    console.log('\n失败列表:', results.failed.join(', '));
  }
  
  console.log(`\n📁 数据已保存到: ${DATA_DIR}`);
}

main().catch(console.error);
