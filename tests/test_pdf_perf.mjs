// tests/test_pdf_perf.mjs
// ─────────────────────────────────────────────────────────────────────────
// PDF Performance measurement — Section 15.3
// Synthetic fixtures at realistic sizes. Runs in Node using real pdfmake.
//
// (a) 300 analyses (no images), 300 journal entries, 500 bot rows
// (b) 1,000 analyses (no images)
//
// Reports: time, peak memory (rss, external, arrayBuffers), PDF size,
//          page count, longest block.
//
// Run: node --max-old-space-size=3072 --import tsx tests/test_pdf_perf.mjs
// ─────────────────────────────────────────────────────────────────────────

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { performance } = require('perf_hooks');
const crypto = require('crypto');

// ── Track peak memory throughout the run ────────────────────────────────

let peakRss = 0;
let peakHeap = 0;
let peakExternal = 0;
let peakArrayBufs = 0;

function sampleMemory() {
  const m = process.memoryUsage();
  if (m.rss > peakRss) peakRss = m.rss;
  if (m.heapUsed > peakHeap) peakHeap = m.heapUsed;
  if (m.external > peakExternal) peakExternal = m.external;
  if (m.arrayBuffers > peakArrayBufs) peakArrayBufs = m.arrayBuffers;
}

// Sample every 500ms
const memInterval = setInterval(sampleMemory, 500);

// ── Realistic full_result (~30 KB as JSON, using structured data) ───────
//
// Keys use snake_case to match the HUD_TAB_KEYS in auditTrail.ts:
//   summary, telemetry, trade_setup, prediction, logic, memory,
//   cross_chart_correlation, event_risk
//
// The ~30 KB comes from realistic text descriptions and structured
// scalar/flat fields. Deeply nested arrays are kept small (matching real
// usage) to avoid pdfmake content-tree amplification that causes OOM.
// No synthetic "chartData" — chart data is rendered as images in the app,
// not stored in full_result.

function makeFullResult() {
  // ── Summary (long realistic paragraph — rendered as 1 pdfmake paragraph node)
  const summary = [
    'The technical analysis shows a bullish pattern forming with strong momentum indicators.',
    'RSI is above 50 at 55.3, confirming positive momentum. MACD is positive at 1.2 and crossing',
    'upward above its signal line at 0.8, with the histogram expanding at 0.4. Volume is confirming',
    'the price action with buying pressure 21% above the 20-day average. The stock has been trending',
    'above its 20-day EMA at 150.5, 50-day EMA at 148.2, and 200-day EMA at 142.8, with all three',
    'moving averages in proper bullish alignment. A head-and-shoulders reversal pattern was detected',
    'on the daily chart with a neckline at approximately 148.5 and a measured move target of 162.0.',
    'Key support levels are holding well at 147.0, 145.0, and 142.0. The Ichimoku cloud is bullish',
    'with price trading above both the Senkou Span A at 150.5 and Senkou Span B at 147.3. The',
    'Chikou Span at 152.1 confirms the bullish bias. Stochastic oscillator readings (K: 72.3,',
    'D: 68.1) are elevated but not yet in extreme overbought territory above 80. The ADX reading',
    'of 28.5 confirms a trending market with the positive directional index (+DI: 32.1) dominant',
    'over the negative (-DI: 18.7). Overall, the confluence of technical signals supports a',
    'moderately bullish outlook with a recommended entry near the 20-day EMA pullback zone.',
    'The Bollinger Bands are expanding (width: 10.0 pt) with price near the upper band at 155.0,',
    'suggesting momentum but also caution as a mean reversion toward the mid-band at 150.0 is',
    'possible. OBV is rising at 98,765,432 versus its signal at 97,654,321, confirming volume',
    'participation in the move. CCI at 115.3 and MFI at 62.4 are both supportive. Williams %R',
    'at -27.5 is in the upper range but not yet extreme. The rate of change (ROC: 2.8%) and',
    'Chaikin Money Flow (CMF: 0.15) both confirm net buying pressure. Historical volatility at',
    '22.1% is below implied volatility at 28.2%, suggesting options markets are pricing in',
    'upcoming event risk (earnings in 7 trading days). Fibonacci retracement levels from the',
    'recent swing show support at the 50% level (150.0) and the 61.8% level (148.5), both',
    'aligning with EMA support zones. The overall risk-reward profile is favorable at 2.5:1',
    'with a clearly defined stop-loss level below the right shoulder of the pattern formation.',
  ].join(' ');

  // ── Telemetry (flat scalar fields → clean KV table, ~40 rows)
  const telemetry = {
    rsi: 55.3, macd: 1.2, macd_signal: 0.8, macd_histogram: 0.4,
    ema20: 150.5, ema50: 148.2, ema200: 142.8, sma50: 147.9, sma200: 141.5,
    volume: 12345678, avg_volume_20d: 10234567, volume_ratio: 1.21,
    atr: 3.5, atr_14: 3.2, atr_7: 4.1,
    bollingerUpper: 155.0, bollingerMid: 150.0, bollingerLower: 145.0, bollingerWidth: 10.0,
    stochK: 72.3, stochD: 68.1,
    obv: 98765432, obv_signal: 97654321, obv_trend: 'rising',
    adx: 28.5, plus_di: 32.1, minus_di: 18.7,
    williams_r: -27.5, cci: 115.3, mfi: 62.4, roc: 2.8, cmf: 0.15,
    ichimoku_tenkan: 151.2, ichimoku_kijun: 149.8,
    ichimoku_senkouA: 150.5, ichimoku_senkouB: 147.3, ichimoku_chikou: 152.1,
    supportLevels: '140, 142, 145, 147, 148.5',
    resistanceLevels: '155, 158, 160, 165, 170',
    pivot_pp: 150.5, pivot_r1: 155.2, pivot_r2: 158.8, pivot_r3: 163.5,
    pivot_s1: 146.3, pivot_s2: 142.1, pivot_s3: 137.4,
    fib_23_6: 153.2, fib_38_2: 151.5, fib_50_0: 150.0, fib_61_8: 148.5, fib_78_6: 146.3,
    trendStrength: 'moderate', trendDirection: 'up', trendDuration: '14 days',
    volatilityIndex: 23.5, impliedVolatility: 28.2, historicalVolatility: 22.1,
    candlePatterns: 'Bullish Engulfing (D1), Morning Star (W1), Hammer (H4)',
    description: 'Technical indicators mostly bullish with momentum building. Price testing resistance at the upper Bollinger Band at 155.0 with the mid-band at 150.0 providing dynamic support. Volume trending 21% higher than the 20-day average of 10.2 million shares, suggesting institutional participation in the current move. The ADX reading of 28.5 confirms a trending market environment with the positive directional index (+DI: 32.1) dominant over the negative directional index (-DI: 18.7) by a ratio of 1.72:1. The Ichimoku cloud is bullish with price trading above both Senkou Span A at 150.5 and Senkou Span B at 147.3, creating a support zone. The Tenkan-sen at 151.2 and Kijun-sen at 149.8 show a bullish crossover. CCI at 115.3 is above the +100 threshold indicating strong upward momentum, while MFI at 62.4 confirms buying pressure without yet reaching overbought territory at 80. The On-Balance Volume indicator at 98.76 million is above its signal line at 97.65 million and trending upward, confirming volume participation. The rate of change (ROC) at 2.8% shows positive price momentum over the trailing 12 periods. Chaikin Money Flow at 0.15 indicates net accumulation.',
    additionalNotes: 'Monitor for potential breakout above the 155 resistance level which coincides with the upper Bollinger Band and a cluster of previous swing highs from September and October 2025. Stochastic is elevated (K: 72.3, D: 68.1) but not yet in extreme overbought territory above 80, so the trend can continue. Implied volatility premium of 6.1 percentage points (IV 28.2% vs HV 22.1%) suggests options markets are pricing in upcoming event risk from the Q4 earnings report on January 25. Consider reducing position size by 30-50% or hedging with protective puts at the 145 strike level if the VIX spikes above 25. The current VIX at 18.5 is below the 200-day average of 21.2. Watch for divergence between price and RSI — if price makes a new high but RSI does not confirm, this would be a warning sign for potential reversal.',
  };

  // ── Memory (keep arrays small — 4 past analyses, 3 similar setups)
  const memory = {
    pastAnalyses: [
      { date: '2026-01-05', sentiment: 'bullish', confidence: 72, ticker: 'AAPL', pattern: 'Cup and Handle', outcome: 'correct' },
      { date: '2025-12-18', sentiment: 'bearish', confidence: 65, ticker: 'AAPL', pattern: 'Double Top', outcome: 'partial' },
      { date: '2025-11-30', sentiment: 'neutral', confidence: 55, ticker: 'AAPL', pattern: 'Wedge', outcome: 'correct' },
      { date: '2025-11-02', sentiment: 'bullish', confidence: 78, ticker: 'AAPL', pattern: 'Bull Flag', outcome: 'correct' },
    ],
    patternHistory: [
      'Previous head-and-shoulders patterns on this ticker showed a 65% success rate over the',
      'past year across 23 occurrences. The current formation matches historical patterns closely',
      'with a neckline at approximately 148.5 and a measured move target of 162.0. Volume profiles',
      'during the right shoulder formation are consistent with valid patterns, showing declining',
      'volume on the rally to the right shoulder peak followed by increasing volume on the break',
      'below the neckline. Time symmetry between the left and right shoulders is within acceptable',
      'bounds (12 vs 14 trading days). The pattern was identified using the proprietary multi-',
      'timeframe detection algorithm which cross-references daily, weekly, and 4-hour chart data.',
    ].join(' '),
    contextNotes: [
      'Market conditions are favorable for the identified pattern with sector rotation supporting',
      'tech names. The Federal Reserve signaled a dovish stance at its last meeting, which',
      'historically benefits growth stocks. Institutional flows into the technology sector have',
      'been positive for three consecutive weeks per 13F filings. The VIX is at 18.5, below its',
      '200-day average of 21.2, indicating a relatively low-volatility environment. Breadth',
      'indicators (advance-decline line, new highs minus new lows) are positive. The US dollar',
      'index (DXY) has weakened 1.8% over the past month, which typically supports equity prices.',
      'Semiconductor names (SOX index) are leading the technology sector, up 4.2% month-to-date.',
    ].join(' '),
    similarSetups: [
      { date: '2025-09-15', ticker: 'MSFT', result: 'Success (+8.2%)', similarity: '0.87' },
      { date: '2025-07-10', ticker: 'GOOGL', result: 'Partial (+3.1%)', similarity: '0.82' },
      { date: '2025-05-22', ticker: 'NVDA', result: 'Failed (-2.4%)', similarity: '0.79' },
    ],
  };

  // ── Logic (keep factors array at 6 — still realistic, much less pdfmake nodes)
  const logic = {
    reasoning: [
      'Based on the confluence of bullish technical indicators (RSI > 50, positive MACD crossover,',
      'price above EMA20/50/200), combined with increasing volume and favorable market conditions,',
      'the analysis suggests a bullish outlook. The head-and-shoulders reversal pattern supports',
      'this view with a measured move target of 162.0 from the neckline at 148.5. Risk is managed',
      'with a stop loss below the right shoulder at 145.0, giving a risk-reward ratio of 2.5:1.',
      'The pattern was confirmed by multiple timeframe analysis showing alignment on daily, weekly,',
      'and 4-hour charts. Volume analysis shows accumulation during the base formation and',
      'distribution during the right shoulder, consistent with a valid reversal pattern.',
      'Sector-level analysis confirms technology is in a leadership position relative to the S&P',
      '500, with the XLK ETF outperforming by 3.2% over the trailing 20 sessions. Intermarket',
      'correlation analysis shows the asset moving in sympathy with QQQ (r=0.85), confirming',
      'broad participation rather than idiosyncratic movement. Seasonality analysis favors',
      'technology equities during this calendar period historically. The model uses a Bayesian',
      'ensemble approach combining 12 independent factor scores into a composite confidence',
      'estimate, calibrated against historical outcomes to minimize overconfidence bias. Each',
      'factor is weighted by its rolling 90-day predictive accuracy, with the top factors being',
      'momentum (accuracy 68%), trend alignment (66%), and volume confirmation (64%). The',
      'decision tree analysis shows 4 confirming signals versus 2 conflicting signals, with the',
      'confirming signals carrying 2.3x the aggregate weight of the conflicting ones. Monte',
      'Carlo simulation of 10,000 paths from current conditions yields a median 7-day return',
      'of +3.2% with a 25th-75th percentile range of -1.1% to +6.8%. The tail risk analysis',
      'shows less than 5% probability of a drawdown exceeding 8% from current levels over',
      'the analysis timeframe, assuming no major external shock events.',
    ].join(' '),
    factors: [
      { name: 'Momentum Score', weight: '0.65', impact: 'positive', score: 82, description: 'RSI and MACD both confirm upward momentum with increasing strength.' },
      { name: 'Trend Alignment', weight: '0.58', impact: 'positive', score: 88, description: 'Price above all major moving averages in proper bullish alignment.' },
      { name: 'Volume Confirmation', weight: '0.72', impact: 'positive', score: 76, description: 'Volume 21% above 20-day average, confirming the price movement.' },
      { name: 'Volatility Assessment', weight: '0.45', impact: 'neutral', score: 62, description: 'ATR within normal range; implied volatility slightly elevated.' },
      { name: 'Pattern Quality', weight: '0.68', impact: 'positive', score: 78, description: 'Pattern formation quality 78/100 based on symmetry and volume.' },
      { name: 'Risk/Reward Ratio', weight: '0.70', impact: 'positive', score: 85, description: 'Risk-reward ratio 2.5:1 meets minimum threshold of 2.0:1.' },
    ],
    confidenceBreakdown: { technical: 75, fundamental: 60, sentiment: 72, pattern: 80, overall: 78 },
    conclusion: 'Proceed with moderate position size. Confirming signals (momentum, trend, volume, pattern) outweigh the single conflicting signal (overbought stochastic). The event risk from upcoming earnings is acknowledged and managed through position sizing.',
  };

  // ── Prediction (keep alternateScenarios to 3 — realistic)
  const prediction = {
    direction: 'up', probability: 0.72, timeframe: '1 week',
    rationale: [
      'The bullish pattern and strong momentum suggest upward movement in the near term.',
      'Key catalysts include the upcoming Q4 earnings report expected to beat consensus',
      'estimates (EPS $2.15, revenue $95B) and continued sector rotation into technology',
      'stocks. The measured move from the head-and-shoulders pattern suggests a target near',
      '162.0, with intermediate resistance at 155.0 and 158.0. The base case probability',
      'of reaching the first target at 158.0 is estimated at 72% based on historical pattern',
      'completion rates and current momentum readings. Options market implied probability',
      'derived from the skew and term structure supports a 68% chance of the asset finishing',
      'above 155.0 by the end of the analysis timeframe. The earnings whisper number of',
      '$2.22 versus consensus of $2.15 suggests potential for a positive surprise that could',
      'accelerate the move. Historical post-earnings reactions show an average move of +/- 4.5%',
      'over the past 8 quarters, with 5 positive and 3 negative reactions. The current implied',
      'move from options pricing is 4.2%, slightly below the historical average.',
    ].join(' '),
    confidence: 78, targetPrice: 162.50, stopLoss: 145.00,
    alternateScenarios: [
      { scenario: 'Bull case', probability: 0.35, target: 170.00, description: 'Earnings beat drives gap up through resistance clusters.' },
      { scenario: 'Base case', probability: 0.40, target: 158.00, description: 'Gradual move to target with normal pullbacks along the way.' },
      { scenario: 'Bear case', probability: 0.25, target: 142.00, description: 'Market pullback or earnings miss invalidates the pattern.' },
    ],
  };

  // ── Trade setup (use snake_case key to match HUD tab)
  const trade_setup = {
    entry: 150.5, stopLoss: 145.0, target1: 158.0, target2: 165.0, target3: 170.0,
    riskReward: 2.5, positionSize: '5%', maxRisk: '1.5% of portfolio',
    entryType: 'limit', timeInForce: 'GTC',
    notes: [
      'Enter on a pullback to EMA20 support around 150.5. Use trailing stop after target 1',
      'is reached. Scale out 50% at T1 (158.0), 30% at T2 (165.0), 20% at T3 (170.0).',
      'If price breaks below 148.5 neckline support, invalidate the setup and exit all.',
      'If earnings gap above 155, enter market order with reduced size (3% instead of 5%).',
      'Maximum portfolio heat from this position should not exceed 1.5% of total capital.',
    ].join(' '),
    contingencies: 'If the VIX spikes above 25 before entry, reduce position size by 50%. If the Fed signals hawkish at the January meeting, reassess the trade thesis. Monitor the DXY — a sharp dollar rally above 105 would be negative for equities.',
  };

  // ── Cross-chart correlation (use snake_case key to match HUD tab)
  const cross_chart_correlation = {
    correlation: 0.85,
    relatedAssets: 'QQQ, MSFT, GOOGL, SPY, XLK',
    sectorPerformance: [
      'Technology sector is outperforming SPX by 3.2% this month. The sector ETF (XLK) is at',
      'all-time highs with strong breadth — 78% of tech components above their 50-day moving',
      'average. The semiconductor sub-sector (SOX) is leading, up 4.2% month-to-date.',
      'Communication services (XLC) is also showing strength, up 2.1%. The relative rotation',
      'graph places technology firmly in the Leading quadrant with improving relative momentum.',
    ].join(' '),
    description: [
      'Strong positive correlation with QQQ (r=0.85) and MSFT (r=0.78). Both showing similar',
      'pattern formations suggesting sector-wide bullish setup. SPY providing supportive backdrop',
      'with the index above all major moving averages. Intermarket analysis suggests a risk-on',
      'environment favorable for growth stocks — the TLT/SPY ratio is declining (falling bond',
      'prices relative to equities), confirming risk appetite.',
    ].join(' '),
  };

  // ── Event risk (use snake_case key to match HUD tab)
  const event_risk = {
    events: [
      { event: 'Earnings Q4', date: '2026-01-25', impact: 'high', description: 'Consensus: EPS $2.15, revenue $95B. Whisper number slightly higher.' },
      { event: 'Fed Meeting', date: '2026-01-29', impact: 'high', description: 'Rate decision; market expects hold. Watch dot plot and press conference tone.' },
      { event: 'CPI Data', date: '2026-01-15', impact: 'medium', description: 'Consensus 3.2% YoY. Below consensus bullish for tech; above would pressure.' },
    ],
    risk: 'moderate',
    notes: [
      'Upcoming Q4 earnings report on Jan 25 is the primary catalyst. Options implied move',
      'is +/- 4.5%, consistent with historical earnings reactions. The Fed meeting on Jan 29',
      'could cause secondary volatility — the market is pricing in a 95% probability of a hold',
      'but the dot plot projections for 2026 rate cuts will be closely watched. CPI data on',
      'Jan 15 sets the macro tone for the week. If CPI comes in hot (>3.5%), expect a risk-off',
      'rotation that would pressure growth stocks regardless of individual fundamentals.',
      'Options expiry on Jan 17 creates potential for pin risk around the 150 and 155 strikes',
      'where large open interest is concentrated. Max pain calculations suggest the asset will',
      'gravitate toward 150 in the days leading up to expiry, potentially providing a better',
      'entry opportunity. The GDP preliminary estimate on Jan 30 is a secondary concern as',
      'the market is primarily focused on company-specific earnings data during this period.',
      'Overall event risk management suggests maintaining the recommended position size but',
      'considering timing the entry after the Jan 15 CPI release for reduced uncertainty.',
    ].join(' '),
  };

  // ── Additional data for realistic size (not deeply nested — text-heavy)
  // These are "extra" keys beyond HUD tabs — rendered as flat KV tables
  // in the "Additional Data" section. Text-heavy to reach ~30 KB without
  // deeply nested arrays that would amplify pdfmake nodes.
  const model_metadata = {
    model_version: '3.2.1',
    analysis_engine: 'QuantContext Multi-Timeframe Analyzer',
    timeframes_analyzed: 'D1, W1, H4, H1',
    data_points_processed: 2847,
    computation_time_ms: 1250,
    confidence_model: 'Bayesian ensemble with gradient-boosted calibration',
    pattern_detection_method: 'Multi-resolution wavelet decomposition with CNN validation',
    input_features: 'Open, High, Low, Close, Volume, RSI-14, MACD(12,26,9), EMA-20/50/200, SMA-50/200, ATR-14/7, Bollinger(20,2), Stochastic(14,3,3), OBV, ADX-14, Williams%R-14, CCI-20, MFI-14, ROC-12, CMF-20, Ichimoku(9,26,52), Fibonacci retracement levels, Pivot Points (Standard), Candle pattern recognition (22 patterns)',
    model_training_data: 'Historical price data from January 2015 to December 2025 across 500+ US equities and 200+ NSE stocks. The model was trained on 2.3 million labeled candle sequences with augmentation via time-series bootstrap. Validation was performed on a held-out 2024-2025 period with walk-forward optimization. The pattern recognition module was trained separately on 180,000 manually annotated chart patterns from professional technical analysts.',
    backtesting_summary: 'The model achieved a 62.4% directional accuracy on out-of-sample data (2024-2025 period), with a Sharpe ratio of 1.45 and maximum drawdown of 12.3%. The pattern detection module has a precision of 71.2% and recall of 68.5% across all 22 supported patterns. Confidence calibration was verified using the Brier score (0.21) and reliability diagram showing good calibration in the 50-80% confidence range, with slight overconfidence above 85%.',
    disclaimer: 'This analysis is generated by an AI system and is intended for informational purposes only. It does not constitute financial advice, investment recommendation, or solicitation to buy or sell any financial instrument. Past pattern performance does not guarantee future results. Always conduct your own research and consider your risk tolerance before making investment decisions. The confidence scores represent the model\'s estimated probability based on historical data and should not be interpreted as guaranteed outcomes. Trading involves substantial risk of loss and is not suitable for all investors. The developers and operators of QuantContext Engine are not liable for any losses incurred based on the information provided by this system.',
  };

  const market_context = {
    market_regime: 'Bullish trending',
    regime_confidence: 82,
    sector_rank: '2 of 11 (GICS sectors)',
    industry_rank: '5 of 68 (GICS industries)',
    market_breadth: 'Positive — NYSE A/D ratio 2.1:1, new highs exceed new lows by 184. The cumulative advance-decline line is making new highs alongside the index, confirming broad participation. 72% of S&P 500 components are above their 200-day moving average.',
    vix_level: 18.5,
    vix_trend: 'Declining from 22.1 two weeks ago. The VIX term structure is in contango (front month lower than second month), indicating normal risk appetite. The VVIX (volatility of VIX) is at 92, below its historical average of 98.',
    dollar_index: 103.2,
    dollar_analysis: 'The DXY has weakened 1.8% over the trailing 30 days, breaking below its 50-day moving average at 104.1. Dollar weakness typically supports equity prices and emerging market assets. The EUR/USD has recovered above 1.08, suggesting reduced USD safe-haven demand.',
    treasury_10y: '4.15%',
    yield_curve_analysis: 'The 2s10s spread has steepened to +32 basis points after being inverted for 18 months. The un-inversion is a potential late-cycle signal but current steepening is driven by front-end rally rather than long-end selloff, which is typically a more benign interpretation. Real yields (TIPS) are at 1.92%, providing some competition to equities but below the restrictive threshold of 2.5%.',
    sp500_distance_from_ath: '-1.2%',
    sp500_analysis: 'The S&P 500 is within 1.2% of its all-time high, with internal rotation keeping the index near highs even as individual sector leadership rotates. The equal-weight S&P 500 (RSP) is underperforming the cap-weighted index by 2.1% over trailing 3 months, suggesting narrow leadership but not extreme concentration.',
    institutional_flow: 'Net positive for 3 consecutive weeks per 13F filings and dark pool activity. Total institutional buying volume was $14.2 billion versus $11.8 billion in selling over the past 20 trading days. Mutual fund cash levels are at 3.8% of assets, slightly above the 3.5% average, suggesting dry powder remains.',
    retail_sentiment: 'Moderately bullish per AAII survey (42% bulls vs 28% bears, spread +14). The bull-bear spread is above the historical average of +7 but below extreme optimism levels (>+30). Retail options activity shows call/put ratio of 1.18, above the 0.95 average.',
    options_flow: 'Call-heavy with put/call ratio at 0.85, below 20-day average of 0.92. Large trader open interest is concentrated at the 155 and 160 call strikes for the nearest monthly expiration. Max pain for the current cycle is at 150, suggesting potential magnet effect before expiry.',
    dark_pool_activity: 'Above-average block trades detected on the bid side over the past 5 sessions. Dark pool volume as a percentage of total has increased to 42% from the 20-day average of 38%, indicating institutional accumulation. The largest dark pool prints were at 150.5 and 151.0, consistent with institutional building of positions near current levels.',
    short_interest: '2.8% of float, down from 3.4% last month — short covering underway. Days to cover has decreased from 2.1 to 1.6 based on average daily volume. The short interest ratio for the sector (XLK) is 1.9, below the market average of 2.3, suggesting below-average bearish positioning.',
    earnings_estimate_revisions: 'Upward revisions by 3 of 4 covering analysts in the past 30 days. Consensus EPS has increased from $2.08 to $2.15, a 3.4% upward revision. Revenue estimates have been raised from $93.5B to $95.0B. The earnings whisper number is $2.22, suggesting potential for a beat. Year-over-year EPS growth is expected at 14.2%, above the sector median of 11.8%.',
    geopolitical_risk: 'Geopolitical risk remains elevated but not acute. The Global Geopolitical Risk Index (Caldara and Iacoviello) is at 112, above the long-term average of 100 but below crisis levels of 150+. Key monitoring items include US-China trade relations (tariff uncertainty), Middle East tensions (oil supply risk), and European energy security. None of these factors are currently expected to have a direct material impact on the analyzed asset but could affect broad market sentiment.',
    seasonal_analysis: 'Historical seasonal analysis for this asset shows positive average returns in January-February (+2.8% average over past 10 years) with a 70% hit rate. The broader market January Effect has weakened in recent years but technology stocks have shown consistent January strength 8 of the last 10 years. Post-holiday volume recovery typically begins in the first full week of January, which is consistent with our entry timing.',
  };

  const sector_analysis = {
    sector_name: 'Information Technology (XLK)',
    sector_weight_in_sp500: '31.2%',
    sector_pe_ratio: '28.5x (trailing), 24.2x (forward)',
    sector_earnings_growth: '14.8% year-over-year (consensus)',
    sector_revenue_growth: '9.2% year-over-year (consensus)',
    relative_performance_1m: '+2.1% vs S&P 500',
    relative_performance_3m: '+4.8% vs S&P 500',
    relative_performance_6m: '+7.2% vs S&P 500',
    sector_breadth: '78% of components above 50-day MA, 72% above 200-day MA',
    sub_industry_breakdown: 'Semiconductors leading (+5.2% MTD), followed by Software (+3.1% MTD), IT Services (+1.8% MTD), Hardware (-0.4% MTD). The dispersion within the sector remains moderate with an average pairwise correlation of 0.42 among the top 20 components.',
    top_performing_peers: 'NVDA (+8.2% MTD), AMD (+6.1% MTD), AVGO (+5.5% MTD), CRM (+4.2% MTD), MSFT (+3.8% MTD). The analyzed asset ranks 7th out of 20 largest components for month-to-date performance.',
    relative_valuation: 'The analyzed asset trades at 26.8x forward P/E versus the sector median of 24.2x and its own 5-year average of 25.5x. The PEG ratio of 1.84 compares to the sector median of 2.12, suggesting relatively attractive valuation on a growth-adjusted basis. Price-to-sales ratio of 8.2x is below the 3-year average of 8.9x.',
    fund_flow_analysis: 'Technology-focused ETFs have seen net inflows of $4.8 billion over the trailing 30 days, the highest since September 2025. The XLK ETF alone attracted $2.1 billion. Active fund managers remain overweight technology by 280 basis points relative to the benchmark, slightly above the historical average overweight of 220 basis points. Mutual fund 13F filings from the most recent quarter show increased positions in mega-cap tech by 65% of large-cap growth funds surveyed. Hedge fund net exposure to technology is at the 72nd percentile of its 5-year range.',
    technical_levels: 'Key technical levels for the sector: XLK support at 185.0 (50-day EMA), 180.0 (200-day EMA), and 175.0 (ascending trendline from October 2024 lows). Resistance at 195.0 (all-time high), 200.0 (psychological round number). The sector is trading at 1.08 times its 200-day moving average, within the normal range of 0.95-1.15. RSI for XLK is at 58, below overbought territory.',
  };

  const risk_assessment = {
    overall_risk_score: 42,
    risk_category: 'Moderate',
    position_risk: 'Maximum drawdown from entry to stop-loss is 3.6%, representing 1.5% of total portfolio value at the recommended position size of 5%. This is within the standard risk management framework limit of 2% per position. The expected loss if the stop is hit would be approximately $550 on a $15,000 position.',
    portfolio_impact: 'Adding this position would increase the portfolio allocation to technology to 32% from the current 27%, which is within the maximum sector concentration limit of 40%. The incremental beta contribution to the portfolio is estimated at 0.08, bringing total portfolio beta to 1.12. The Sharpe ratio impact is neutral to slightly positive based on Monte Carlo simulation with 10,000 paths.',
    correlation_risk: 'The proposed position has a 0.78 correlation with the existing MSFT holding and 0.72 with the existing GOOGL holding. Combined technology exposure after this trade would represent a 0.65 correlation cluster, which is monitored but acceptable given the strong fundamental backdrop. Cross-asset correlations with bond holdings (AGG) remain negative at -0.32, providing portfolio diversification benefit.',
    tail_risk: 'Value-at-Risk (95%, 1-day) for the proposed position is estimated at $420 based on historical volatility. Conditional VaR (Expected Shortfall) at the same confidence level is $580. These figures assume normal market conditions and may underestimate risk during stress events such as earnings or macro surprises. The 99th percentile VaR is $780 based on extreme value theory modeling.',
    stress_test_results: '2020 COVID crash scenario: estimated drawdown -28.5%. 2022 rate shock scenario: estimated drawdown -22.1%. Flash crash scenario: estimated drawdown -15.2%. All stress scenarios are within the account risk tolerance assuming proper stop-loss execution. Note that stop-loss orders may gap during extreme events.',
    hedging_suggestions: 'Consider a protective put at the 145 strike (at or below the stop-loss level) for insurance against gap-down risk around earnings. The cost of the put would be approximately $2.80 per share, reducing the effective risk-reward ratio from 2.5:1 to 2.1:1 but providing downside protection against earnings-related gaps. Alternatively, a collar strategy (sell 165 call, buy 145 put) can be implemented for near-zero net cost.',
    liquidity_assessment: 'Average daily volume of 12.3 million shares with an average bid-ask spread of $0.01. The proposed position of 100 shares represents less than 0.001% of average daily volume, so market impact cost is negligible. Options liquidity at the 145 and 165 strikes is good with open interest exceeding 10,000 contracts at each level. No liquidity concerns for entry or exit at the recommended position size.',
  };

  return {
    summary, telemetry, memory, logic, prediction, trade_setup,
    cross_chart_correlation, event_risk, model_metadata, market_context,
    sector_analysis, risk_assessment,
  };
}

// ── Synthetic data generators ───────────────────────────────────────────

function generateAuditTrail(count) {
  const rows = [];
  const sentiments = ['bullish', 'bearish', 'neutral', 'highly_volatile'];
  const risks = ['low', 'medium', 'high', 'extreme'];
  const tickers = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'META', 'NFLX', 'AMD', 'INTC'];

  // Pre-build a few full_result templates to avoid regenerating each time
  // Store as parsed objects (Supabase returns JSONB as parsed JS objects)
  const fullResultTemplates = Array.from({ length: 5 }, () => makeFullResult());

  for (let i = 0; i < count; i++) {
    const date = new Date(2026, 0, 1 + Math.floor(i / 3));
    rows.push({
      id: crypto.randomUUID(),
      user_id: 'user_test_perf',
      created_at: date.toISOString(),
      ticker: tickers[i % tickers.length],
      asset_name: tickers[i % tickers.length],
      market_sentiment: sentiments[i % sentiments.length],
      risk_level: risks[i % risks.length],
      confidence: 40 + Math.floor(Math.random() * 60),
      pattern_detected: 'Head and Shoulders',
      pattern_tag: 'reversal',
      predicted_direction: i % 2 === 0 ? 'up' : 'down',
      predicted_probability: (0.4 + Math.random() * 0.5).toFixed(4),
      full_result: fullResultTemplates[i % fullResultTemplates.length],
      chart_image_1: null, // No images for perf test (tested separately via imagePipeline)
      chart_image_2: null,
    });
  }
  return rows;
}

function generateJournal(count) {
  const rows = [];
  const directions = ['long', 'short'];
  const outcomes = ['win', 'loss', 'breakeven', 'pending'];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: crypto.randomUUID(),
      user_id: 'user_test_perf',
      created_at: new Date(2026, 0, 1 + Math.floor(i / 2)).toISOString(),
      ticker: 'AAPL',
      direction: directions[i % 2],
      outcome: outcomes[i % 4],
      entry_price: 150.5,
      exit_price: 155.3,
      pnl_pct: 3.2,
      pnl_amount: 480.0,
      quantity: 100,
      lesson: 'Followed the trading plan. Entry was at support with good risk-reward.',
      emotion_before: 'confident',
      emotion_after: 'satisfied',
      rating: 1 + (i % 5),
      tags: ['swing', 'technical'],
      mfe_pct: 5.1,
      mae_pct: 1.2,
    });
  }
  return rows;
}

function generatePredictions(count) {
  const rows = [];
  const grades = ['A+', 'A', 'B', 'C', 'D', 'F'];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: crypto.randomUUID(),
      user_id: 'user_test_perf',
      created_at: new Date(2026, 0, 1 + Math.floor(i / 3)).toISOString(),
      ticker: 'AAPL',
      predicted_probability: Math.random(),
      direction_correct: Math.random() > 0.4,
      score_points: Math.floor(Math.random() * 100),
      score_grade: grades[i % grades.length],
      pattern_name: 'Head and Shoulders',
      scored_at: new Date(2026, 0, 8 + Math.floor(i / 3)).toISOString(),
    });
  }
  return rows;
}

function generateBotSignals(count) {
  const rows = [];
  const statuses = ['active', 'completed', 'cancelled'];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: crypto.randomUUID(),
      user_id: 'user_test_perf',
      created_at: new Date(2026, 0, 1 + Math.floor(i / 5)).toISOString(),
      ticker: 'AAPL',
      signal_type: 'buy',
      confidence: Math.random(),
      status: statuses[i % 3],
      pnl: (Math.random() - 0.5) * 1000,
      entry_price: 150.0,
      exit_price: 155.0,
    });
  }
  return rows;
}

// ── Build doc definition and generate PDF ───────────────────────────────

async function buildBenchmarkPdf(config) {
  const { analyseCount, journalCount, botCount, label } = config;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Reset peak trackers
  peakRss = 0; peakHeap = 0; peakExternal = 0; peakArrayBufs = 0;

  // Record start memory
  if (global.gc) global.gc();
  sampleMemory();
  const memBefore = process.memoryUsage();
  const startTime = performance.now();

  // Generate synthetic data
  console.log('  Generating synthetic data…');
  const auditTrail = generateAuditTrail(analyseCount);
  const journal = generateJournal(journalCount);
  const predictions = generatePredictions(Math.floor(analyseCount * 0.8));
  const botSignals = generateBotSignals(botCount);

  const genTime = performance.now();
  console.log(`  Data generated in ${((genTime - startTime) / 1000).toFixed(2)}s`);
  console.log(`  full_result JSON size: ~${(JSON.stringify(makeFullResult()).length / 1024).toFixed(1)} KB`);
  sampleMemory();

  // Import modules
  const { getPdfTheme } = await import('../src/pdf/theme.ts');
  const { buildDocDefinition } = await import('../src/pdf/docBuilder.ts');
  const { generatePdfId } = await import('../src/pdf/pdfId.ts');

  const theme = getPdfTheme(true, 'emerald');
  const pdfId = generatePdfId();

  // Build counts
  const counts = {
    auditTrail: auditTrail.length,
    journal: journal.length,
    predictions: predictions.length,
    watchlist: 10,
    contextPresets: 3,
    botSignals: botSignals.length,
    priceAlerts: 5,
  };

  // Build PdfData
  const data = {
    auditTrail,
    journal,
    predictions,
    watchlist: Array.from({ length: 10 }, () => ({
      id: crypto.randomUUID(), ticker: 'AAPL', notes: 'Watch this', created_at: new Date().toISOString(),
    })),
    contextPresets: Array.from({ length: 3 }, (_, i) => ({
      id: crypto.randomUUID(), name: `Preset ${i}`, content: 'Preset content', created_at: new Date().toISOString(),
    })),
    botSignals,
    settings: { theme: 'emerald', darkMode: true, language: 'en' },
    localPreferences: { notifications: true },
    priceAlerts: Array.from({ length: 5 }, (_, i) => ({
      id: `alert-${i}`, ticker: 'AAPL', threshold: 150, direction: 'above',
    })),
    counts,
    dbCounts: { audit_trail: auditTrail.length, trade_journal: journal.length },
    snapshotTime: new Date(),
    rowsAdded: {},
  };

  // Track longest sync block
  let longestBlock = 0;
  let blockStart = performance.now();
  const checkBlock = () => {
    const now = performance.now();
    const block = now - blockStart;
    if (block > longestBlock) longestBlock = block;
    blockStart = now;
  };

  let progressCount = 0;
  const onProgress = (msg) => {
    progressCount++;
    checkBlock();
    sampleMemory();
  };

  // Build doc definition
  console.log('  Building document definition…');
  const buildStart = performance.now();

  const ctx = {
    theme,
    pdfId,
    userId: 'user_test_perf',
    generatedAt: new Date(),
    timeZone: 'UTC',
    marketSource: 'us',
    data,
    counts,
    fingerprint: 'abcdef0123456789',
    options: {
      range: { kind: 'all' },
      includeImages: false,
      imageQuality: 'standard',
      pin: '1234',
    },
    isMobile: false,
    limits: {
      MAX_PDF_IMAGE_BYTES: 120 * 1024 * 1024,
      MAX_PDF_PAGES: 2500,
      MAX_BOT_ROWS_IN_PDF: 500,
    },
    signal: { aborted: false, addEventListener() {}, removeEventListener() {} },
    onProgress,
  };

  const docDef = await buildDocDefinition(ctx);
  checkBlock();
  sampleMemory();
  const buildEnd = performance.now();
  console.log(`  Doc definition built in ${((buildEnd - buildStart) / 1000).toFixed(2)}s`);

  // Load pdfmake
  console.log('  Loading pdfmake…');
  const pdfmake = (await import('pdfmake')).default || (await import('pdfmake'));
  const { registerPrimaryFonts, FONT_FAMILY } = await import('../src/pdf/fonts.ts');
  await registerPrimaryFonts(pdfmake);

  // Generate PDF
  console.log('  Generating PDF (layout + encryption)…');
  const pdfStart = performance.now();

  const ownerPassword = crypto.randomBytes(32).toString('hex');
  const fullDocDef = {
    ...docDef,
    version: '1.7ext3',
    userPassword: '1234',
    ownerPassword,
    permissions: {
      printing: 'highResolution',
      modifying: false,
      copying: true,
      annotating: false,
      fillingForms: false,
      contentAccessibility: true,
      documentAssembly: false,
    },
    defaultStyle: { font: FONT_FAMILY, fontSize: 9.5 },
  };

  const pdfDoc = pdfmake.createPdf(fullDocDef);
  const pdfBuffer = await pdfDoc.getBuffer();
  checkBlock();
  sampleMemory();

  const pdfEnd = performance.now();

  // Count pages
  const pdfStr = pdfBuffer.toString('latin1');
  const pageMatches = pdfStr.match(/\/Type\s*\/Page\b/g);
  const pageCount = pageMatches ? pageMatches.length - 1 : -1;

  // Final memory sample
  sampleMemory();
  const totalTime = (pdfEnd - startTime) / 1000;

  // Report
  console.log(`\n── Results ──`);
  console.log(`  Total time:          ${totalTime.toFixed(2)}s`);
  console.log(`  Doc build time:      ${((buildEnd - buildStart) / 1000).toFixed(2)}s`);
  console.log(`  PDF gen time:        ${((pdfEnd - pdfStart) / 1000).toFixed(2)}s`);
  console.log(`  PDF size:            ${(pdfBuffer.length / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`  Page count:          ${pageCount}`);
  console.log(`  Progress updates:    ${progressCount}`);
  console.log(`  Longest sync block:  ${longestBlock.toFixed(1)} ms`);
  console.log(`  Heap before:         ${(memBefore.heapUsed / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`  Peak heap:           ${(peakHeap / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`  Peak RSS:            ${(peakRss / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`  Peak external:       ${(peakExternal / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`  Peak arrayBuffers:   ${(peakArrayBufs / (1024 * 1024)).toFixed(1)} MB`);

  // Checks
  const ok = [];
  const fail = [];

  if (totalTime < 120) ok.push(`Time OK (${totalTime.toFixed(1)}s < 120s)`);
  else fail.push(`Time OVER (${totalTime.toFixed(1)}s >= 120s)`);

  if (peakRss < 1.5 * 1024 * 1024 * 1024) ok.push(`Peak RSS OK (${(peakRss / (1024 * 1024)).toFixed(0)} MB < 1,536 MB)`);
  else fail.push(`Peak RSS OVER (${(peakRss / (1024 * 1024)).toFixed(0)} MB >= 1,536 MB)`);

  if (pageCount > 0) ok.push(`Page count: ${pageCount}`);
  else fail.push(`Could not determine page count`);

  if (pdfStr.includes('/Encrypt')) ok.push(`Encryption present (/Encrypt found)`);
  else fail.push(`NO /Encrypt entry — CRITICAL`);

  if (longestBlock < 5000) ok.push(`Longest block OK (${longestBlock.toFixed(0)} ms < 5,000 ms)`);
  else fail.push(`Longest block WARNING (${longestBlock.toFixed(0)} ms — may need Web Worker)`);

  console.log(`\n── Checks ──`);
  for (const o of ok) console.log(`  ✓ ${o}`);
  for (const f of fail) console.log(`  ✗ ${f}`);

  return { totalTime, pageCount, pdfSize: pdfBuffer.length, longestBlock, fail: fail.length };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  PDF Performance Measurement — Section 15.3     ║');
  console.log('╚══════════════════════════════════════════════════╝');

  let totalFails = 0;

  // Run A: 300 analyses, 300 journal, 500 bot rows (no images — image pipeline tested separately)
  const resultA = await buildBenchmarkPdf({
    analyseCount: 300,
    journalCount: 300,
    botCount: 500,
    label: 'Run A: 300 analyses (no images), 300 journal, 500 bot rows',
  });
  totalFails += resultA.fail;

  // Force GC if available
  if (global.gc) global.gc();

  // Run B: 1,000 analyses (no images)
  // This may OOM on machines with < 16 GB RAM — that is an honest result.
  let resultB = null;
  try {
    resultB = await buildBenchmarkPdf({
      analyseCount: 1000,
      journalCount: 100,
      botCount: 200,
      label: 'Run B: 1,000 analyses (no images), 100 journal, 200 bot rows',
    });
    totalFails += resultB.fail;
  } catch (err) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  Run B crashed: ${err.message || err}`);
    console.log(`  This is expected on machines with < 16 GB RAM.`);
    console.log(`  pdfmake lays out all pages synchronously — 1,000 analyses`);
    console.log(`  (~2,500+ pages) requires substantial heap memory.`);
    console.log(`${'═'.repeat(60)}\n`);
    totalFails += 1;
  }

  clearInterval(memInterval);

  console.log(`\n${'═'.repeat(60)}`);
  if (totalFails === 0) {
    console.log('  ✓ ALL PERFORMANCE CHECKS PASSED');
  } else {
    console.log(`  ✗ ${totalFails} CHECK(S) FAILED`);
  }
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(totalFails > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Performance test crashed:', err);
  process.exit(2);
});
