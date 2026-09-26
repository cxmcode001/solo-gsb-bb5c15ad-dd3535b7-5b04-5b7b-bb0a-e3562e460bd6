import React, { useState } from 'react';
import BoardDiagram, { partColor } from './BoardDiagram.jsx';
import { cutStatus, markCut, undoCut } from './cutProgress.js';

const SAMPLE_BOARD = { boardWidth: 2440, boardHeight: 1220, kerf: 3, boardPrice: 180 };

// 临时余板库存（每块带唯一编号，长 / 宽均为正数；每块最多使用一次）
const SAMPLE_STOCKS = [
  { id: 'YB-01', width: 1200, height: 800 },
  { id: 'YB-02', width: 320, height: 150 }, // 示例中放不进任何零件，展示“未用”状态
];

const SAMPLE_ORDERS = [
  {
    orderNo: 'SO-1001',
    parts: [
      { name: '柜门', width: 600, height: 400, quantity: 8 },
      { name: '侧板', width: 800, height: 350, quantity: 3 },
      { name: '抽屉面', width: 500, height: 200, quantity: 6 },
    ],
  },
  {
    orderNo: 'SO-1002',
    parts: [
      { name: '柜门', width: 600, height: 400, quantity: 4 }, // 与 SO-1001 同名零件
      { name: '背板条', width: 1000, height: 120, quantity: 2 },
      { name: '层板', width: 700, height: 300, quantity: 2 },
    ],
  },
];

const EMPTY_PART = { name: '', width: '', height: '', quantity: 1 };
const emptyOrder = (i) => ({ orderNo: '', parts: [{ ...EMPTY_PART }] });
const EMPTY_STOCK = { id: '', width: '', height: '' };

// 机台开料排程示例机台：唯一名称、最大单刀长度、切割速度（长度 / 秒）、每板准备秒数；
// 分时电费核算另需运行功率（千瓦）与开工时刻（HH:mm）
const SAMPLE_MACHINES = [
  { name: '机台A', maxCutLength: 1300, speed: 600, setupSeconds: 30, power: 5.5, startTime: '08:00' },
  { name: '机台B', maxCutLength: 900, speed: 400, setupSeconds: 20, power: 4, startTime: '08:00' },
];
const EMPTY_MACHINE = { name: '', maxCutLength: '', speed: '', setupSeconds: '', power: '', startTime: '' };

// 分时电价示例：谷段（凌晨）0.3 元 / 度、峰段（白天）1.0 元 / 度；
// 时段必须无重叠且完整覆盖 00:00～24:00
const SAMPLE_TARIFFS = [
  { start: '00:00', end: '08:00', price: '0.3' },
  { start: '08:00', end: '24:00', price: '1.0' },
];
const EMPTY_TARIFF = { start: '', end: '', price: '' };

// 损坏件三元身份：订单号 + 零件名 + 件号（跨订单同名零件互不影响）
const itemKey = (order, part, index) => JSON.stringify([order, part, index]);

// 刀路执行记录：板上无任何已完成刀时的共享空集（避免每次渲染新建）
const EMPTY_SET = new Set();

// 设备最大单刀长度：留空表示不限制；填写时必须为正数
const validateMaxCut = (value) => {
  const s = String(value).trim();
  if (s === '') return true;
  const n = Number(s);
  return Number.isFinite(n) && n > 0;
};

// 余料回收最小尺寸：留空表示不筛选；填写时必须为非负数字
const validateMinOffcut = (value) => {
  const s = String(value).trim();
  if (s === '') return true;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0;
};

// 开工时刻：HH:mm（00:00～23:59），允许省略小时前导 0
const validateStartTime = (value) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh <= 23 && mm <= 59;
};

// 电价时段时刻：开始 00:00～23:59；结束允许 24:00（表示一日之末）
const validateTariffClock = (value, allowEnd24) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (mm > 59 || hh > 24) return false;
  if (hh === 24) return allowEnd24 && mm === 0;
  return true;
};

// HH:mm 转分钟数（输入须已通过校验）
const clockToMinutes = (value) => {
  const [hh, mm] = String(value).trim().split(':').map(Number);
  return hh * 60 + mm;
};

export default function App() {
  const [boardWidth, setBoardWidth] = useState(String(SAMPLE_BOARD.boardWidth));
  const [boardHeight, setBoardHeight] = useState(String(SAMPLE_BOARD.boardHeight));
  const [kerf, setKerf] = useState(String(SAMPLE_BOARD.kerf));
  const [boardPrice, setBoardPrice] = useState(String(SAMPLE_BOARD.boardPrice));
  const [maxCutLength, setMaxCutLength] = useState('');
  const [minOffcutLength, setMinOffcutLength] = useState('');
  const [minOffcutWidth, setMinOffcutWidth] = useState('');
  const [stocks, setStocks] = useState(SAMPLE_STOCKS.map((s) => ({ ...s })));
  const [orders, setOrders] = useState(SAMPLE_ORDERS.map((o) => ({
    orderNo: o.orderNo,
    parts: o.parts.map((p) => ({ ...p })),
  })));
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 缺件补切：选中的损坏件（Set of itemKey）、补切结果与状态
  const [selected, setSelected] = useState(new Set());
  const [recut, setRecut] = useState(null);
  const [recutError, setRecutError] = useState('');
  const [recutLoading, setRecutLoading] = useState(false);
  // 撤单影响预览：生成方案时的输入快照、选中的撤单订单号、预览结果与状态
  const [snapshot, setSnapshot] = useState(null);
  const [cancelOrder, setCancelOrder] = useState('');
  const [cancelPreview, setCancelPreview] = useState(null);
  const [cancelError, setCancelError] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  // 可回收余料清单：勾选的余料编号、已追加到库存的余料编号（同一方案不重复追加）、
  // 以及追加到库存后的最终余板编号（用于库存行“新追加”标记）
  const [offcutSelected, setOffcutSelected] = useState(new Set());
  const [addedOffcuts, setAddedOffcuts] = useState(new Set());
  const [appendedStockIds, setAppendedStockIds] = useState(new Set());
  // 连续批次用料预演：已保存的批次快照（保存后修改表单不影响）、预演结果与状态
  const [batches, setBatches] = useState([]);
  const [batchResult, setBatchResult] = useState(null);
  const [batchError, setBatchError] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);
  // 机台开料排程：机台清单（2～3 台）、排程结果与状态
  const [machines, setMachines] = useState(SAMPLE_MACHINES.map((m) => ({ ...m })));
  const [schedule, setSchedule] = useState(null);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleLoading, setScheduleLoading] = useState(false);
  // 分时电费核算：一天内电价时段（无重叠完整覆盖 00:00～24:00）、核算结果与状态
  const [tariffs, setTariffs] = useState(SAMPLE_TARIFFS.map((t) => ({ ...t })));
  const [electricity, setElectricity] = useState(null);
  const [electricityError, setElectricityError] = useState('');
  const [electricityLoading, setElectricityLoading] = useState(false);
  // 刀路执行记录：{ 板号: Set(已完成刀序) } 与逐板操作提示；仅存当前页面并绑定
  // 当前生成方案——修改表单不影响记录，重新生成方案时清空
  const [cutDone, setCutDone] = useState({});
  const [cutHints, setCutHints] = useState({});

  // ---- 订单 / 零件行编辑 ----
  const updateOrder = (oi, key, value) => {
    setOrders((prev) => prev.map((o, idx) => (idx === oi ? { ...o, [key]: value } : o)));
  };
  const updatePart = (oi, pi, key, value) => {
    setOrders((prev) => prev.map((o, oidx) => {
      if (oidx !== oi) return o;
      return { ...o, parts: o.parts.map((p, pidx) => (pidx === pi ? { ...p, [key]: value } : p)) };
    }));
  };
  const addOrder = () => setOrders((prev) => [...prev, emptyOrder(prev.length)]);
  const removeOrder = (oi) => setOrders((prev) => prev.filter((_, idx) => idx !== oi));
  const addPart = (oi) => {
    setOrders((prev) => prev.map((o, idx) => (
      idx === oi ? { ...o, parts: [...o.parts, { ...EMPTY_PART }] } : o
    )));
  };
  const removePart = (oi, pi) => {
    setOrders((prev) => prev.map((o, oidx) => {
      if (oidx !== oi || o.parts.length <= 1) return o;
      return { ...o, parts: o.parts.filter((_, pidx) => pidx !== pi) };
    }));
  };

  // ---- 临时余板库存行编辑（允许清空到 0 行；提交时空行被忽略，非空行必须完整）----
  const updateStock = (si, key, value) => {
    setStocks((prev) => prev.map((s, idx) => (idx === si ? { ...s, [key]: value } : s)));
  };
  const addStock = () => setStocks((prev) => [...prev, { ...EMPTY_STOCK }]);
  const removeStock = (si) => setStocks((prev) => prev.filter((_, idx) => idx !== si));

  const resetRecut = () => {
    setSelected(new Set());
    setRecut(null);
    setRecutError('');
  };

  const resetCancel = () => {
    setSnapshot(null);
    setCancelOrder('');
    setCancelPreview(null);
    setCancelError('');
  };

  const resetOffcuts = () => {
    setOffcutSelected(new Set());
    setAddedOffcuts(new Set());
    setAppendedStockIds(new Set());
  };

  const resetSchedule = () => {
    setSchedule(null);
    setScheduleError('');
    // 排程失效时分时核算也一并失效（核算沿用同一排程）
    setElectricity(null);
    setElectricityError('');
  };

  // 刀路执行记录：仅绑定当前生成方案，重新生成方案时清空
  const resetCutExec = () => {
    setCutDone({});
    setCutHints({});
  };

  // 仅计价参数（功率、开工时刻、电价时段）变化：只清空电费核算，保留原排程
  const resetElectricity = () => {
    setElectricity(null);
    setElectricityError('');
  };

  const loadSample = () => {
    setBoardWidth(String(SAMPLE_BOARD.boardWidth));
    setBoardHeight(String(SAMPLE_BOARD.boardHeight));
    setKerf(String(SAMPLE_BOARD.kerf));
    setBoardPrice(String(SAMPLE_BOARD.boardPrice));
    setMaxCutLength('');
    setMinOffcutLength('');
    setMinOffcutWidth('');
    setStocks(SAMPLE_STOCKS.map((s) => ({ ...s })));
    setOrders(SAMPLE_ORDERS.map((o) => ({ orderNo: o.orderNo, parts: o.parts.map((p) => ({ ...p })) })));
    setResult(null);
    setError('');
    resetRecut();
    resetCancel();
    resetOffcuts();
    resetCutExec();
    setMachines(SAMPLE_MACHINES.map((m) => ({ ...m })));
    setTariffs(SAMPLE_TARIFFS.map((t) => ({ ...t })));
    resetSchedule();
  };

  // 组装请求载荷并校验余板行：全空行忽略；非空行必须编号唯一且长 / 宽为正数
  const buildPayload = () => {
    const seenIds = new Set();
    const stockBoards = [];
    for (let i = 0; i < stocks.length; i++) {
      const s = stocks[i];
      const id = String(s.id ?? '').trim();
      const ws = String(s.width).trim();
      const hs = String(s.height).trim();
      if (id === '' && ws === '' && hs === '') continue; // 空行不下发
      if (id === '') return { error: `第 ${i + 1} 块余板缺少唯一编号` };
      if (seenIds.has(id)) return { error: `余板编号重复：${id}` };
      const w = Number(ws);
      const h = Number(hs);
      if (!Number.isFinite(w) || w <= 0) return { error: `余板「${id}」的长度必须为正数` };
      if (!Number.isFinite(h) || h <= 0) return { error: `余板「${id}」的宽度必须为正数` };
      seenIds.add(id);
      stockBoards.push({ id, width: w, height: h });
    }
    const payload = {
      boardWidth: Number(boardWidth),
      boardHeight: Number(boardHeight),
      kerf: kerf === '' ? 0 : Number(kerf),
      boardPrice: boardPrice === '' ? 0 : Number(boardPrice),
      // 留空不下发该字段：后端按不限制处理，沿用现有排料规则
      ...(maxCutLength.trim() !== '' ? { maxCutLength: Number(maxCutLength) } : {}),
      // 余料回收最小尺寸：留空不下发，后端不筛选、列出全部空闲余料
      ...(minOffcutLength.trim() !== '' ? { minOffcutLength: Number(minOffcutLength) } : {}),
      ...(minOffcutWidth.trim() !== '' ? { minOffcutWidth: Number(minOffcutWidth) } : {}),
      stockBoards,
      orders: orders.map((o) => ({
        orderNo: o.orderNo,
        parts: o.parts.map((p) => ({
          name: p.name,
          width: Number(p.width),
          height: Number(p.height),
          quantity: Number(p.quantity),
        })),
      })),
    };
    return { payload };
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validateMaxCut(maxCutLength)) {
      setError('设备最大单刀长度必须为正数（留空则不限制）');
      return;
    }
    if (!validateMinOffcut(minOffcutLength) || !validateMinOffcut(minOffcutWidth)) {
      setError('余料回收最小长度 / 最小宽度必须是非负数字（留空则不筛选）');
      return;
    }
    const { payload, error: stockError } = buildPayload();
    if (stockError) {
      setError(stockError);
      return;
    }
    setResult(null);
    resetRecut();
    resetCancel();
    resetOffcuts();
    resetSchedule();
    resetCutExec();
    setLoading(true);
    try {
      const res = await fetch('/api/cut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || '计算失败，请检查输入');
      } else {
        setResult(data.result);
        // 固定本次方案的输入快照与订单号（空白订单号以后端自动编号为准），
        // 撤单预览按快照计算，之后修改表单不影响已生成方案的预览
        setSnapshot(payload);
        setCancelOrder(data.result.orders[0] ? data.result.orders[0].order : '');
      }
    } catch (err) {
      setError('无法连接排料服务，请确认后端已启动');
    } finally {
      setLoading(false);
    }
  };

  // ---- 缺件补切 ----
  const toggleDamaged = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submitRecut = async () => {
    if (!result || selected.size === 0) return;
    setRecutError('');
    if (!validateMaxCut(maxCutLength)) {
      setRecutError('设备最大单刀长度必须为正数（留空则不限制）');
      return;
    }
    const { payload, error: stockError } = buildPayload();
    if (stockError) {
      setRecutError(stockError);
      return;
    }
    setRecut(null);
    setRecutLoading(true);
    // 按分单取件清单顺序收集选中的损坏件（三元身份）
    const damaged = [];
    for (const pl of result.pickList) {
      for (const it of pl.items) {
        if (selected.has(itemKey(pl.order, it.part, it.index))) {
          damaged.push({ order: pl.order, part: it.part, index: it.index });
        }
      }
    }
    try {
      // 提交时以当前排料输入为准，后端重新计算原方案并校验所选件；
      // 余板库存仍随原方案提交（后端重算原方案用），补切本身只开标准新板
      const res = await fetch('/api/recut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, damaged }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setRecutError(data.error || '补切计算失败，请检查所选损坏件');
      } else {
        setRecut(data.result.recut);
      }
    } catch (err) {
      setRecutError('无法连接排料服务，请确认后端已启动');
    } finally {
      setRecutLoading(false);
    }
  };

  // ---- 撤单影响预览 ----
  const submitCancelPreview = async () => {
    if (!result || !snapshot || !cancelOrder) return;
    setCancelError('');
    setCancelPreview(null);
    setCancelLoading(true);
    try {
      // 以生成该方案时的输入快照提交，后端分别计算撤单前后排料；
      // 原方案与当前表单均不受影响
      const res = await fetch('/api/cancel-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...snapshot, cancelOrder }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setCancelError(data.error || '撤单预览计算失败，请检查所选订单');
      } else {
        setCancelPreview(data.result);
      }
    } catch (err) {
      setCancelError('无法连接排料服务，请确认后端已启动');
    } finally {
      setCancelLoading(false);
    }
  };

  // ---- 连续批次用料预演：保存批次快照 / 逐批预演 ----
  // 保存当前表单为一个批次：payload 为全新对象（快照），之后修改表单不影响该批次
  const saveBatch = () => {
    setBatchError('');
    if (!validateMaxCut(maxCutLength)) {
      setBatchError('设备最大单刀长度必须为正数（留空则不限制）');
      return;
    }
    if (!validateMinOffcut(minOffcutLength) || !validateMinOffcut(minOffcutWidth)) {
      setBatchError('余料回收最小长度 / 最小宽度必须是非负数字（留空则不筛选）');
      return;
    }
    const { payload, error: stockError } = buildPayload();
    if (stockError) {
      setBatchError(stockError);
      return;
    }
    setBatches((prev) => [...prev, payload]);
    setBatchResult(null); // 批次清单变化后，旧预演结果不再适用
  };

  const removeBatch = (i) => {
    setBatches((prev) => prev.filter((_, idx) => idx !== i));
    setBatchResult(null);
  };

  const clearBatches = () => {
    setBatches([]);
    setBatchResult(null);
    setBatchError('');
  };

  // 开始连续预演：按保存顺序提交全部批次快照；预演为只读，不改动表单与单次排料结果
  const runBatchPreview = async () => {
    if (batches.length === 0) return;
    setBatchError('');
    setBatchResult(null);
    setBatchLoading(true);
    try {
      const res = await fetch('/api/batch-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batches }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setBatchError(data.error || '连续预演失败，请检查各批次输入');
      } else {
        setBatchResult(data.result);
      }
    } catch (err) {
      setBatchError('无法连接排料服务，请确认后端已启动');
    } finally {
      setBatchLoading(false);
    }
  };

  // ---- 机台开料排程：机台行编辑 ----
  // 名称 / 上限 / 速度 / 准备秒数属于排程参数：修改后排程与电费核算都需重算
  const updateMachine = (mi, key, value) => {
    setMachines((prev) => prev.map((m, idx) => (idx === mi ? { ...m, [key]: value } : m)));
    resetSchedule();
  };
  // 运行功率 / 开工时刻仅属于计价参数：修改后只重新核算电费，不改变原排程
  const updateMachinePricing = (mi, key, value) => {
    setMachines((prev) => prev.map((m, idx) => (idx === mi ? { ...m, [key]: value } : m)));
    resetElectricity();
  };
  const addMachine = () => {
    setMachines((prev) => (prev.length >= 3 ? prev : [...prev, { ...EMPTY_MACHINE }]));
    resetSchedule();
  };
  const removeMachine = (mi) => {
    setMachines((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== mi)));
    resetSchedule();
  };

  // ---- 分时电价时段编辑（至少 1 段；修改后只清空电费核算）----
  const updateTariff = (ti, key, value) => {
    setTariffs((prev) => prev.map((t, idx) => (idx === ti ? { ...t, [key]: value } : t)));
    resetElectricity();
  };
  const addTariff = () => {
    setTariffs((prev) => (prev.length >= 48 ? prev : [...prev, { ...EMPTY_TARIFF }]));
    resetElectricity();
  };
  const removeTariff = (ti) => {
    setTariffs((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== ti)));
    resetElectricity();
  };

  // 校验机台行：排程参数（名称 / 上限 / 速度 / 准备秒数）始终校验；
  // withPricing=true 时另校验运行功率（非负）与开工时刻（HH:mm）。
  // 返回 { machines } 或 { error }。
  const parseMachineRows = (withPricing) => {
    const parsed = [];
    const seenNames = new Set();
    for (let i = 0; i < machines.length; i++) {
      const m = machines[i];
      const name = String(m.name ?? '').trim();
      if (!name) return { error: `第 ${i + 1} 台机台缺少唯一名称` };
      if (seenNames.has(name)) return { error: `机台名称重复：${name}` };
      seenNames.add(name);
      const maxCut = Number(m.maxCutLength);
      if (!Number.isFinite(maxCut) || maxCut <= 0) {
        return { error: `机台「${name}」的最大单刀长度必须为正数` };
      }
      const speed = Number(m.speed);
      if (!Number.isFinite(speed) || speed <= 0) {
        return { error: `机台「${name}」的切割速度必须为正数` };
      }
      const setup = Number(m.setupSeconds);
      if (!Number.isFinite(setup) || setup < 0) {
        return { error: `机台「${name}」的每板准备秒数必须是非负数字` };
      }
      const row = { name, maxCutLength: maxCut, speed, setupSeconds: setup };
      if (withPricing) {
        const power = String(m.power ?? '').trim();
        if (power === '') return { error: `机台「${name}」缺少运行功率（千瓦）` };
        const powerKw = Number(power);
        if (!Number.isFinite(powerKw) || powerKw < 0) {
          return { error: `机台「${name}」的运行功率必须是非负数字（千瓦）` };
        }
        if (!validateStartTime(m.startTime)) {
          return { error: `机台「${name}」的开工时刻必须是 00:00～23:59 的 HH:mm 时刻` };
        }
        row.power = powerKw;
        row.startTime = String(m.startTime).trim();
      }
      parsed.push(row);
    }
    if (parsed.length < 2 || parsed.length > 3) {
      return { error: '机台开料排程需要 2～3 台机台' };
    }
    return { machines: parsed };
  };

  // 校验电价时段：逐段格式合法、价格非负；排序后无重叠且完整覆盖 00:00～24:00。
  // 返回 { tariffs } 或 { error }。
  const parseTariffRows = () => {
    if (!tariffs.length) return { error: '请至少填写 1 个电价时段' };
    const parsed = [];
    for (let i = 0; i < tariffs.length; i++) {
      const t = tariffs[i];
      const start = String(t.start ?? '').trim();
      const end = String(t.end ?? '').trim();
      if (!validateTariffClock(start, false)) {
        return { error: `第 ${i + 1} 个电价时段的开始时刻必须是 00:00～23:59 的 HH:mm 时刻` };
      }
      if (!validateTariffClock(end, true)) {
        return { error: `第 ${i + 1} 个电价时段的结束时刻必须是 00:00～24:00 的 HH:mm 时刻（24:00 仅可作为结束）` };
      }
      const sm = clockToMinutes(start);
      const em = clockToMinutes(end);
      if (em <= sm) {
        return { error: `第 ${i + 1} 个电价时段结束时刻必须晚于开始时刻（同日时刻，不含跨午夜段）` };
      }
      const price = String(t.price ?? '').trim();
      if (price === '') return { error: `第 ${i + 1} 个电价时段缺少电价（元 / 千瓦时）` };
      const rate = Number(price);
      if (!Number.isFinite(rate) || rate < 0) {
        return { error: `第 ${i + 1} 个电价时段的电价必须是非负数字（元 / 千瓦时）` };
      }
      parsed.push({ startMinute: sm, endMinute: em, start, end, price: rate });
    }
    parsed.sort((a, b) => a.startMinute - b.startMinute);
    if (parsed[0].startMinute !== 0) {
      return { error: '电价时段必须从 00:00 开始完整覆盖一整天' };
    }
    if (parsed[parsed.length - 1].endMinute !== 1440) {
      return { error: '电价时段必须完整覆盖到 24:00，不能提前结束' };
    }
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].startMinute < parsed[i - 1].endMinute) {
        return { error: `电价时段在 ${parsed[i].start} 附近重叠：各时段不得相互重叠` };
      }
      if (parsed[i].startMinute !== parsed[i - 1].endMinute) {
        return {
          error: `电价时段在 ${parsed[i - 1].end}～${parsed[i].start} 之间存在空档：` +
            '必须无重叠且完整覆盖 00:00～24:00',
        };
      }
    }
    return { tariffs: parsed.map(({ startMinute: _s, endMinute: _e, ...rest }) => rest) };
  };

  // 计算机台排程：以生成方案时的输入快照 + 当前机台清单提交；
  // 排程为只读计算，不改动表单与已生成的排料结果
  const submitSchedule = async () => {
    if (!result || !snapshot) return;
    setScheduleError('');
    const { machines: parsed, error } = parseMachineRows(false);
    if (error) {
      setScheduleError(error);
      return;
    }
    setSchedule(null);
    setScheduleLoading(true);
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...snapshot, machines: parsed }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setScheduleError(data.error || '机台排程失败，请检查机台参数');
      } else {
        setSchedule(data.result);
      }
    } catch (err) {
      setScheduleError('无法连接排料服务，请确认后端已启动');
    } finally {
      setScheduleLoading(false);
    }
  };

  // 分时电费核算：沿用生成方案时的输入快照与当前机台参数（含功率、开工时刻）+ 电价时段；
  // 后端重算同一排程后把每板起止秒数换算为实际时刻并分段计费，原排料与排程不变
  const submitElectricity = async () => {
    if (!result || !snapshot) return;
    setElectricityError('');
    const { machines: parsedMachines, error: machineError } = parseMachineRows(true);
    if (machineError) {
      setElectricityError(machineError);
      return;
    }
    const { tariffs: parsedTariffs, error: tariffError } = parseTariffRows();
    if (tariffError) {
      setElectricityError(tariffError);
      return;
    }
    setElectricity(null);
    setElectricityLoading(true);
    try {
      const res = await fetch('/api/electricity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...snapshot, machines: parsedMachines, tariffs: parsedTariffs }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setElectricityError(data.error || '分时电费核算失败，请检查计价参数');
      } else {
        setElectricity(data.result);
      }
    } catch (err) {
      setElectricityError('无法连接排料服务，请确认后端已启动');
    } finally {
      setElectricityLoading(false);
    }
  };

  // ---- 可回收余料清单：勾选与一键追加到临时余板库存 ----
  const toggleOffcut = (id) => {
    setOffcutSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllOffcuts = () => {
    if (!result || !result.offcuts) return;
    const selectable = result.offcuts.filter((oc) => !addedOffcuts.has(oc.id));
    const allChecked = selectable.length > 0 && selectable.every((oc) => offcutSelected.has(oc.id));
    setOffcutSelected((prev) => {
      const next = new Set(prev);
      for (const oc of selectable) {
        if (allChecked) next.delete(oc.id);
        else next.add(oc.id);
      }
      return next;
    });
  };

  // 追加选中余料到临时余板库存（用于下一次排料）：
  // 编号 = B来源板号-R区域序号，与现有余板编号冲突时自动加 -2、-3… 避让；
  // 同一方案中已追加过的余料不再重复追加
  const appendOffcuts = () => {
    if (!result || !result.offcuts) return;
    const taken = new Set(stocks.map((s) => String(s.id ?? '').trim()).filter(Boolean));
    const rows = [];
    const doneIds = [];
    const doneStockIds = [];
    for (const oc of result.offcuts) {
      if (addedOffcuts.has(oc.id) || !offcutSelected.has(oc.id)) continue;
      let id = oc.id;
      if (taken.has(id)) {
        let n = 2;
        while (taken.has(`${oc.id}-${n}`)) n += 1;
        id = `${oc.id}-${n}`;
      }
      taken.add(id);
      rows.push({ id, width: oc.w, height: oc.h });
      doneIds.push(oc.id);
      doneStockIds.push(id);
    }
    if (rows.length === 0) return;
    setStocks((prev) => [...prev, ...rows]);
    setAddedOffcuts((prev) => new Set([...prev, ...doneIds]));
    setAppendedStockIds((prev) => new Set([...prev, ...doneStockIds]));
    setOffcutSelected((prev) => {
      const next = new Set(prev);
      for (const k of doneIds) next.delete(k);
      return next;
    });
  };

  // ---- 刀路执行记录：标记完成 / 撤销（仅存当前页面，绑定当前方案）----
  // 标记完成：仅当直接前置已完成才可标记；越序时提示缺少的前置刀；重复标记不计数
  const markCutExec = (boardIndex, seq) => {
    const board = result?.boards.find((b) => b.index === boardIndex);
    if (!board) return;
    const done = cutDone[boardIndex] || EMPTY_SET;
    const r = markCut(board.cuts, done, seq);
    if (r.missing) {
      setCutHints((prev) => ({
        ...prev,
        [boardIndex]: `第 ${seq} 刀暂不可执行：缺少前置刀，请先完成第 ${r.missing} 刀`,
      }));
      return;
    }
    if (r.repeated) {
      setCutHints((prev) => ({ ...prev, [boardIndex]: `第 ${seq} 刀已完成，重复标记不计数` }));
      return;
    }
    setCutDone((prev) => ({ ...prev, [boardIndex]: r.done }));
    setCutHints((prev) => ({ ...prev, [boardIndex]: '' }));
  };

  // 撤销一刀：同时撤销其已完成的所有后继刀，保留其他分支状态
  const undoCutExec = (boardIndex, seq) => {
    const board = result?.boards.find((b) => b.index === boardIndex);
    if (!board) return;
    const done = cutDone[boardIndex] || EMPTY_SET;
    const next = undoCut(board.cuts, done, seq);
    const cascaded = [...done].filter((s) => s !== seq && !next.has(s)).sort((a, b) => a - b);
    setCutDone((prev) => ({ ...prev, [boardIndex]: next }));
    setCutHints((prev) => ({
      ...prev,
      [boardIndex]: cascaded.length
        ? `已撤销第 ${seq} 刀，并连带撤销其后继刀：第 ${cascaded.join('、')} 刀`
        : `已撤销第 ${seq} 刀`,
    }));
  };

  return (
    <div className="page">
      <header className="site-header">
        <h1>矩形板材下料 · 多订单拼版断头切割排料</h1>
        <p>多张订单混合拼版：按订单与零件行顺序断头切割，可登记带唯一编号的临时余板库存（已开板放不下时先用余板、最后开标准新板），结果保留订单归属，按单取件并分摊材料费；方案生成后自动列出可回收余料清单，可勾选一键追加回余板库存；损坏件可勾选后生成独立补切方案；还可按订单预览撤单前后影响（原方案与表单不变）；也可把当前表单依次保存为多批做连续批次用料预演（首批余板为初始库存，余料按批回收入池，逐批给出新开标准板与累计材料费）；并可为已生成的方案做机台开料排程：在 2～3 台机台间分配整板加工（每板不可拆分、超单刀上限的机台不可分配），给出逐板机台、起止秒数与最短总完工时间；每张板的裁切图旁还有刀路执行记录：按前置关系逐刀标记完成或撤销（撤销连带后继刀），图上区分已完成、可执行与被阻塞的刀</p>
      </header>

      <main className="layout">
        <section className="panel form-panel">
          <form onSubmit={submit}>
            <h2>原板参数</h2>
            <div className="grid-4">
              <label>
                原板长度
                <input type="number" step="any" min="0" value={boardWidth}
                  onChange={(e) => setBoardWidth(e.target.value)} required />
              </label>
              <label>
                原板宽度
                <input type="number" step="any" min="0" value={boardHeight}
                  onChange={(e) => setBoardHeight(e.target.value)} required />
              </label>
              <label>
                锯缝宽度
                <input type="number" step="any" min="0" value={kerf}
                  onChange={(e) => setKerf(e.target.value)} />
              </label>
              <label>
                单板材料价（元）
                <input type="number" step="0.01" min="0" value={boardPrice}
                  onChange={(e) => setBoardPrice(e.target.value)} />
              </label>
            </div>
            <label className="max-cut-field">
              设备最大单刀长度（选填，留空不限制）
              <input type="number" step="any" min="0" value={maxCutLength}
                placeholder="如 800"
                onChange={(e) => setMaxCutLength(e.target.value)} />
            </label>
            <div className="offcut-filter-fields">
              <label>
                余料回收最小长度（选填）
                <input type="number" step="any" min="0" value={minOffcutLength}
                  placeholder="留空不筛选"
                  onChange={(e) => setMinOffcutLength(e.target.value)} />
              </label>
              <label>
                余料回收最小宽度（选填）
                <input type="number" step="any" min="0" value={minOffcutWidth}
                  placeholder="留空不筛选"
                  onChange={(e) => setMinOffcutWidth(e.target.value)} />
              </label>
            </div>
            <p className="hint">
              长度 / 宽度单位保持一致即可（通常为 mm）；材料价非负、最多两位小数，
              每张开料板均按此价计费，再按各订单在该板的零件面积比例分摊。
              <b>设备最大单刀长度</b>留空时沿用全部既有排料规则；填写后必须为正数，
              系统会对每个候选落位与朝向分别核算竖切优先、横切优先的实际刀长，
              只有该切法<b>每一刀均不超过此上限</b>才会采用，不输出超限刀路。
              <b>余料回收最小长度 / 宽度</b>用于生成方案后筛选可回收余料：
              各板最终空闲矩形（已扣除零件与锯缝）按当前朝向或旋转 90° 后满足
              长 ≥ 最小长度且宽 ≥ 最小宽度即列入余料清单，可勾选后一键追加为临时余板库存。
            </p>

            <div className="parts-head">
              <h2>临时余板库存（{stocks.length}）</h2>
            </div>
            <p className="hint">
              选填。每块余板填写<b>唯一编号</b>与实际<b>长 × 宽</b>（均为正数）。
              排料仍按零件顺序：先在所有已开板的可用矩形中找落位；找不到时
              <b>按此处输入顺序</b>尝试尚未使用且能加工的余板（每块最多使用一次，同样遵守锯缝、旋转与单刀长度限制）；
              最后才开标准新板。<b>余板不计材料费</b>，材料费只对新增标准板分摊；缺件补切只开标准新板，不耗用余板。
            </p>
            <div className="stock-list">
              {stocks.length > 0 && (
                <div className="part-row part-row-head stock-row">
                  <span>余板编号</span>
                  <span>长度</span>
                  <span>宽度</span>
                  <span className="stock-note-col">状态</span>
                  <span className="op-col"></span>
                </div>
              )}
              {stocks.map((s, si) => {
                const used = result?.stockUsed?.find((u) => u.id === String(s.id).trim());
                const isNew = appendedStockIds.has(String(s.id).trim());
                return (
                  <div className="part-row stock-row" key={si}>
                    <input type="text" value={s.id} placeholder="如 YB-01（唯一）"
                      onChange={(e) => updateStock(si, 'id', e.target.value)} />
                    <input type="number" step="any" min="0" value={s.width}
                      onChange={(e) => updateStock(si, 'width', e.target.value)} />
                    <input type="number" step="any" min="0" value={s.height}
                      onChange={(e) => updateStock(si, 'height', e.target.value)} />
                    <span className="stock-note-col">
                      {used ? <span className="stock-tag used">已用 · 第 {used.board} 板</span>
                        : isNew ? <span className="stock-tag new">新追加</span>
                        : result ? <span className="stock-tag">未用</span> : null}
                    </span>
                    <button type="button" className="btn icon op-col" title="删除该余板"
                      onClick={() => removeStock(si)}>✕</button>
                  </div>
                );
              })}
              <button type="button" className="btn ghost wide" onClick={addStock}>
                ＋ 添加余板
              </button>
            </div>

            <div className="parts-head">
              <h2>订单清单（{orders.length}）</h2>
              <button type="button" className="btn ghost" onClick={loadSample}>载入示例</button>
            </div>
            <p className="hint">
              订单号在本次任务中唯一（留空自动编号）；同一订单内零件名不可重复，
              <b>不同订单允许使用同名零件</b>。严格按订单顺序、订单内零件行顺序切割，不做大小重排。
            </p>

            <div className="orders-list">
              {orders.map((o, oi) => (
                <div className="order-card" key={oi}>
                  <div className="order-head">
                    <span className="order-badge">{oi + 1}</span>
                    <input
                      className="order-no-input"
                      type="text"
                      value={o.orderNo}
                      placeholder={`订单${oi + 1}（留空自动编号）`}
                      onChange={(e) => updateOrder(oi, 'orderNo', e.target.value)}
                    />
                    <button type="button" className="btn icon op-col" title="删除该订单"
                      onClick={() => removeOrder(oi)} disabled={orders.length <= 1}>✕</button>
                  </div>
                  <div className="part-row part-row-head">
                    <span>零件名称</span>
                    <span>长度</span>
                    <span>宽度</span>
                    <span>数量</span>
                    <span className="op-col"></span>
                  </div>
                  {o.parts.map((p, pi) => (
                    <div className="part-row" key={pi}>
                      <input value={p.name} placeholder={`零件${pi + 1}`}
                        onChange={(e) => updatePart(oi, pi, 'name', e.target.value)} />
                      <input type="number" step="any" min="0" value={p.width} required
                        onChange={(e) => updatePart(oi, pi, 'width', e.target.value)} />
                      <input type="number" step="any" min="0" value={p.height} required
                        onChange={(e) => updatePart(oi, pi, 'height', e.target.value)} />
                      <input type="number" step="1" min="1" value={p.quantity} required
                        onChange={(e) => updatePart(oi, pi, 'quantity', e.target.value)} />
                      <button type="button" className="btn icon op-col" title="删除该零件"
                        onClick={() => removePart(oi, pi)} disabled={o.parts.length <= 1}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="btn ghost wide" onClick={() => addPart(oi)}>
                    ＋ 添加零件行
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn ghost wide" onClick={addOrder}>＋ 添加订单</button>

            <button type="submit" className="btn primary wide" disabled={loading}>
              {loading ? '正在排料…' : '生成多订单裁切方案'}
            </button>
          </form>

          {/* 连续批次用料预演：从当前表单依次保存多批快照，余板池跨批流转 */}
          <div className="batch-box">
            <div className="parts-head">
              <h2>连续批次用料预演（{batches.length}）</h2>
              {batches.length > 0 && (
                <button type="button" className="btn ghost" onClick={clearBatches}>清空批次</button>
              )}
            </div>
            <p className="hint">
              点击「保存当前表单为一批」把当前<b>订单清单与板材参数</b>快照保存为一个批次
              （保存后修改表单不影响已保存批次），可依次保存多批。
              <b>首批的临时余板库存作为初始库存</b>；预演按保存顺序逐批调用现有排料规则：
              每批从余板池扣除已用编号、保留未用余板，再把本批符合回收尺寸的余料以
              <b>「P批次号-原余料编号」</b>入池供后续批次使用（跨批编号自动避让、不冲突）。
              逐批给出新开标准板数、已用 / 新增余板、批末库存与累计材料费；
              某批无法加工时会指出批次并停止，不提交部分结果；
              预演不改动表单与单次排料结果。
            </p>
            <button type="button" className="btn ghost wide" onClick={saveBatch}>
              ＋ 保存当前表单为第 {batches.length + 1} 批
            </button>
            {batches.length > 0 && (
              <div className="batch-list">
                {batches.map((b, i) => (
                  <div className="batch-item" key={i}>
                    <span className="order-badge">{i + 1}</span>
                    <span className="batch-item-meta">
                      {b.orders.length} 单 · {batchPartCount(b)} 件 ·
                      板 {strip(Number(b.boardWidth))} × {strip(Number(b.boardHeight))} ·
                      ¥{yuan(Math.round(Number(b.boardPrice) * 100))}/张
                      {i === 0 && b.stockBoards.length > 0 && ` · 初始余板 ${b.stockBoards.length} 块`}
                    </span>
                    <button type="button" className="btn icon op-col" title="删除该批次"
                      onClick={() => removeBatch(i)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn primary wide"
              disabled={batches.length === 0 || batchLoading}
              onClick={runBatchPreview}
            >
              {batchLoading ? '正在连续预演…' : `开始连续预演（共 ${batches.length} 批）`}
            </button>
          </div>
        </section>

        <section className="panel result-panel">
          {error && (
            <div className="alert" role="alert">
              <strong>无法排料：</strong>{error}
            </div>
          )}

          {!result && !error && !batchResult && !batchError && (
            <div className="empty">
              <p>填写左侧订单与零件后点击「生成多订单裁切方案」。</p>
              <ul>
                <li>多个订单的零件混合拼版，按订单 / 零件行输入顺序断头切割</li>
                <li>可登记带唯一编号的临时余板库存：已开板放不下时按输入顺序先试余板、最后才开标准新板</li>
                <li>逐板裁切图按实际板尺寸绘制，余板不计材料费，列出余板已用 / 未用编号与新增标准板数</li>
                <li>逐板裁切图、零件落位表与刀序继续可用，色块左上角标注订单号</li>
                <li>结果按订单列出跨板件号、所在板号与坐标，方便分单取件</li>
                <li>每板材料费按订单零件面积比例分摊（最大余数法分配分位尾差）</li>
                <li>在分单取件清单勾选损坏件，可生成独立的缺件补切方案（补切只开标准新板，不耗用余板）</li>
                <li>方案生成后自动给出可回收余料清单（按可配置的最小长 / 宽筛选），可勾选一键追加为临时余板库存</li>
                <li>选择一张订单即可预览撤单影响：按生成方案时的输入快照对比撤单前后用板与材料费，原方案不变</li>
                <li>连续批次用料预演：依次保存多批表单快照，首批余板为初始库存，余料按批回收入池供后续批次使用，逐批给出新开标准板数与累计材料费</li>
                <li>机台开料排程：为已生成的方案在 2～3 台机台间分配整板加工，给出逐板机台、起止秒数与最短总完工时间，不改原排料结果</li>
                <li>刀路执行记录：逐板图旁按刀序标记每刀完成（前置刀完成才可执行，分支可交错），撤销连带后继刀，图上区分已完成 / 可执行 / 被阻塞</li>
                <li>分时电费核算：填写机台运行功率、开工时刻与一天内电价时段（无重叠完整覆盖 00:00～24:00），逐板起止秒数换算实际时刻、跨边界 / 午夜分段计费，列出逐板与逐机台电费，改计价参数即可重新核算</li>
              </ul>
            </div>
          )}

          {result && (
            <>
              <ResultView
                result={result}
                selected={selected}
                onToggleDamaged={toggleDamaged}
                cutDone={cutDone}
                cutHints={cutHints}
                onMarkCut={markCutExec}
                onUndoCut={undoCutExec}
              />
              <OffcutSection
                result={result}
                selected={offcutSelected}
                added={addedOffcuts}
                onToggle={toggleOffcut}
                onToggleAll={toggleAllOffcuts}
                onAppend={appendOffcuts}
              />
              <RecutSection
                selectedCount={selected.size}
                recut={recut}
                error={recutError}
                loading={recutLoading}
                onSubmit={submitRecut}
              />
              <CancelPreviewSection
                orders={result.orders}
                cancelOrder={cancelOrder}
                onSelectOrder={(o) => { setCancelOrder(o); setCancelPreview(null); setCancelError(''); }}
                preview={cancelPreview}
                error={cancelError}
                loading={cancelLoading}
                onSubmit={submitCancelPreview}
              />
              <ScheduleSection
                machines={machines}
                schedule={schedule}
                error={scheduleError}
                loading={scheduleLoading}
                onUpdate={updateMachine}
                onAdd={addMachine}
                onRemove={removeMachine}
                tariffs={tariffs}
                electricity={electricity}
                electricityError={electricityError}
                electricityLoading={electricityLoading}
                onUpdatePricing={updateMachinePricing}
                onTariffUpdate={updateTariff}
                onTariffAdd={addTariff}
                onTariffRemove={removeTariff}
                onSubmitElectricity={submitElectricity}
                onSubmit={submitSchedule}
              />
            </>
          )}

          {(batchResult || batchError) && (
            <BatchPreviewSection result={batchResult} error={batchError} />
          )}
        </section>
      </main>

      <footer className="site-footer">
        断头切割规则：每一刀都贯穿当前所在矩形区域 · 允许零件旋转 90° · 按订单与零件行固定顺序排料 · 可回收余料取自各板最终空闲矩形（不含零件与锯缝），可追加为临时余板库存 · 补切仅重排所选损坏件，原方案不变 · 撤单预览按输入快照对比前后方案，表单与原方案不变 · 连续预演按批次快照逐批排料，余板池跨批流转，表单与单次方案不变 · 机台排程按输入快照重算同一方案，在 2～3 台机台间分配整板加工（超单刀上限的机台不可分配），同一机台按板号顺序连续加工，取全部板完成时间最小的分配，原排料结果不变 · 分时电费核算沿用同一排程，每板起止秒数按机台开工时刻换算实际时刻，跨电价边界或午夜按日循环拆分（分段费用 = 功率 × 加工秒数 ÷ 3600 × 电价，逐板四舍五入到分再汇总），修改计价参数只重新核算、不改原排料与排程 · 刀路执行记录按未舍入几何回放矩形切分得到每刀直接前置（所切矩形的产生刀，初始整板无前置），仅当前置刀已完成才可标记完成，不同分支可交错执行，撤销一刀连带撤销其已完成的所有后继刀；记录仅存当前页面并绑定生成方案，重新生成方案即清空，不影响落位、分摊与排程
      </footer>
    </div>
  );
}

function ResultView({ result, selected, onToggleDamaged, cutDone, cutHints, onMarkCut, onUndoCut }) {
  return (
    <>
      <h2>排料结果</h2>
      <div className="stat-grid">
        <div className="stat"><b>{result.boardsCount}</b><span>用板总数（余板 {result.stockUsed.length} + 新板 {result.standardBoardsCount}）</span></div>
        <div className="stat accent"><b>{result.standardBoardsCount}</b><span>新增标准板数</span></div>
        <div className="stat"><b>{fmt(result.totalParts)}</b><span>零件总数</span></div>
        <div className="stat"><b>{fmt(result.partsArea)}</b><span>零件总面积</span></div>
        <div className="stat"><b>{fmt(result.kerfArea)}</b><span>锯缝损耗面积</span></div>
        <div className="stat accent"><b>{fmt(result.remainderArea)}</b><span>余料总面积</span></div>
        <div className="stat"><b>{result.utilization}%</b><span>总利用率</span></div>
        <div className="stat accent"><b>¥{yuan(result.totalMaterialCents)}</b><span>材料费合计（仅 {result.standardBoardsCount} 张新板，{result.orders.length} 单）</span></div>
      </div>
      <p className="hint">
        标准原板 {strip(result.boardWidth)} × {strip(result.boardHeight)}，
        单板材料价 ¥{yuan(result.boardPrice * 100)}；
        <b>余板库存不计材料费</b>，仅新增标准新板按单板价计费，
        每板再按各订单零件实际面积比例分摊，分位尾差用最大余数法（同余按订单输入顺序）。
        {result.maxCutLength != null ? (
          <>
            <br />
            <b>设备最大单刀长度上限：{strip(result.maxCutLength)}</b>
            （仅在每个候选落位 / 朝向下竖切优先、横切优先的全部刀长均不超过该值时才采用，
            各板实际最长刀长见板图下方统计）。
          </>
        ) : (
          <>
            <br />未设置设备最大单刀长度，不限制单刀长度（沿用既有排料规则）。
          </>
        )}
      </p>

      {/* 临时余板库存耗用情况 */}
      {result.stockBoards.length > 0 && (
        <>
          <h2 className="section-title">临时余板库存耗用</h2>
          <table className="detail-table stock-table">
            <thead>
              <tr><th>状态</th><th>余板编号</th><th>实际尺寸 长×宽</th><th>输入序号</th><th>所在板号</th></tr>
            </thead>
            <tbody>
              {result.stockUsed.map((s) => (
                <tr key={`u-${s.id}`}>
                  <td><span className="stock-tag used">已用</span></td>
                  <td>{s.id}</td>
                  <td>{strip(s.width)} × {strip(s.height)}</td>
                  <td>第 {s.inputIndex} 块</td>
                  <td><span className="board-num">{s.board}</span></td>
                </tr>
              ))}
              {result.stockUnused.map((s) => (
                <tr key={`n-${s.id}`} className="stock-unused-row">
                  <td><span className="stock-tag">未用</span></td>
                  <td>{s.id}</td>
                  <td>{strip(s.width)} × {strip(s.height)}</td>
                  <td>第 {s.inputIndex} 块</td>
                  <td>—</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            共录入 {result.stockBoards.length} 块余板：已用 {result.stockUsed.length} 块、
            未用 {result.stockUnused.length} 块；每块余板最多使用一次，未用余板原样保留库存、不产生费用。
          </p>
        </>
      )}

      {/* 分单取件 */}
      <h2 className="section-title">分单取件清单</h2>
      <p className="hint">勾选「补切」列标记损坏件（按订单号 + 零件名 + 件号区分），然后在页面底部生成补切方案。</p>
      <div className="pick-list">
        {result.pickList.map((pl) => {
          const summary = result.orders.find((o) => o.order === pl.order);
          const boards = summary ? summary.boardIndices : [];
          const crossBoard = boards.length > 1;
          return (
            <div className="pick-order" key={pl.order}>
              <div className="pick-order-head">
                <span className="pick-order-name">订单 {pl.order}</span>
                <span className="pick-order-meta">
                  {pl.items.length} 件 · 面积 {fmt(summary && summary.partsArea)} ·
                  材料费 <b>¥{yuan(summary && summary.materialCents)}</b>
                </span>
                <span className={crossBoard ? 'board-badge cross' : 'board-badge'}>
                  {crossBoard ? `跨 ${boards.length} 板：${boards.join('、')} 号` : `仅 ${boards.join('、')} 号板`}
                </span>
              </div>
              <table className="detail-table pick-table">
                <thead>
                  <tr>
                    <th className="sel-col">补切</th><th>零件件号</th><th>所在板号</th><th>位置 x,y</th>
                    <th>占位 长×宽</th><th>旋转</th>
                  </tr>
                </thead>
                <tbody>
                  {pl.items.map((it, i) => {
                    const key = itemKey(pl.order, it.part, it.index);
                    const checked = selected.has(key);
                    return (
                      <tr key={i}
                        className={`${i > 0 && it.board !== pl.items[i - 1].board ? 'board-start' : ''} ${checked ? 'row-selected' : ''}`}>
                        <td className="sel-col">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleDamaged(key)}
                            title="标记为损坏件，纳入补切"
                          />
                        </td>
                        <td>{it.part} #{it.index}</td>
                        <td><span className="board-num">{it.board}</span></td>
                        <td>{strip(it.x)}, {strip(it.y)}</td>
                        <td>{strip(it.w)} × {strip(it.h)}</td>
                        <td>{it.rotated ? '是' : '否'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* 订单材料费汇总 */}
      <h2 className="section-title">订单材料费汇总</h2>
      <table className="detail-table">
        <thead>
          <tr><th>订单号</th><th>零件数</th><th>零件面积</th><th>所在板号</th><th>材料费（元）</th></tr>
        </thead>
        <tbody>
          {result.orders.map((o) => (
            <tr key={o.order}>
              <td>{o.order}</td>
              <td>{o.partsCount}</td>
              <td>{fmt(o.partsArea)}</td>
              <td>{o.boardIndices.join('、')}</td>
              <td>¥{yuan(o.materialCents)}</td>
            </tr>
          ))}
          <tr className="sum-row">
            <td>合计</td>
            <td>{result.totalParts}</td>
            <td>{fmt(result.partsArea)}</td>
            <td>{result.boardsCount} 张板（余板 {result.stockUsed.length} · 新板 {result.standardBoardsCount}）</td>
            <td>¥{yuan(result.totalMaterialCents)}</td>
          </tr>
        </tbody>
      </table>

      {/* 图例 */}
      <div className="legend">
        <span><i className="sw remainder" />余料</span>
        <span><i className="sw kerf" />锯缝（虚线为刀刃，数字为下刀次序）</span>
        <span><i className="sw cut-done" />已完成刀</span>
        <span><i className="sw cut-ready" />可执行刀</span>
        <span><i className="sw cut-blocked" />被阻塞刀</span>
        {legendKeys(result).map(({ order, part }) => (
          <span key={`${order}⟂${part}`}>
            <i className="sw" style={{ background: partColor(part, order) }} />
            {order} · {part}
          </span>
        ))}
      </div>

      {/* 逐板图与刀序（按每块板的实际尺寸绘图：余板尺寸可能与标准板不同）*/}
      {result.boards.map((b) => {
        const doneSet = cutDone[b.index] || EMPTY_SET;
        const statusMap = cutStatus(b.cuts, doneSet);
        return (
        <div className={`board-card ${b.kind === 'stock' ? 'stock-board' : ''}`} key={b.index}>
          <h3>
            第 {b.index} 张板 / 共 {result.boardsCount} 张
            {b.kind === 'stock' ? (
              <span className="board-kind stock">余板 {b.stockId}（{strip(b.width)} × {strip(b.height)}，不计材料费）</span>
            ) : (
              <span className="board-kind standard">新增标准板（{strip(b.width)} × {strip(b.height)}）</span>
            )}
            {b.kind === 'standard' && <span className="board-price">板价 ¥{yuan(b.cost.priceCents)}</span>}
          </h3>
          <div className="board-main">
            <div className="board-diagram-col">
              <BoardDiagram board={b} boardWidth={b.width} boardHeight={b.height} cutStatus={statusMap} />
            </div>
            <CutExecPanel
              board={b}
              doneSet={doneSet}
              statusMap={statusMap}
              hint={cutHints[b.index] || ''}
              onMark={(seq) => onMarkCut(b.index, seq)}
              onUndo={(seq) => onUndoCut(b.index, seq)}
            />
          </div>
          <div className="board-stats">
            <span>零件 {fmt(b.partsArea)}</span>
            <span>锯缝 {fmt(b.kerfArea)}</span>
            <span>余料 {fmt(b.remainderArea)}</span>
            <span>利用率 {b.utilization}%</span>
            <span>{b.cuts.length} 刀</span>
            <span className="cut-exec-progress">已完成 {doneSet.size} / {b.cuts.length} 刀</span>
            {result.maxCutLength != null && (
              <span className="cut-limit">实际最长刀 {strip(b.longestCut)} / 上限 {strip(result.maxCutLength)}</span>
            )}
          </div>

          {b.kind === 'standard' && b.cost.shares.length > 0 && (
            <table className="detail-table cost-table">
              <thead>
                <tr><th>本板材料费分摊</th><th>零件面积</th><th>面积占比</th><th>分摊额（元）</th></tr>
              </thead>
              <tbody>
                {b.cost.shares.map((s) => (
                  <tr key={s.order}>
                    <td>订单 {s.order}</td>
                    <td>{fmt(s.area)}</td>
                    <td>{s.ratio}%</td>
                    <td>¥{yuan(s.cents)}</td>
                  </tr>
                ))}
                <tr className="sum-row">
                  <td>合计</td>
                  <td>{fmt(b.partsArea)}</td>
                  <td>100%</td>
                  <td>¥{yuan(b.cost.priceCents)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {b.kind === 'stock' && (
            <p className="hint stock-cost-hint">余板库存板不收取材料费，本板零件不产生新的材料分摊。</p>
          )}

          <details>
            <summary>查看零件落位与切割次序明细</summary>
            <table className="detail-table">
              <thead>
                <tr><th>订单</th><th>零件</th><th>件号</th><th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th></tr>
              </thead>
              <tbody>
                {b.placements.map((p, i) => (
                  <tr key={i}>
                    <td>{p.order}</td>
                    <td>{p.part}</td>
                    <td>#{p.index}</td>
                    <td>{strip(p.x)}, {strip(p.y)}</td>
                    <td>{strip(p.w)} × {strip(p.h)}</td>
                    <td>{p.rotated ? '是' : '否'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="detail-table">
              <thead>
                <tr><th>刀序</th><th>方向</th><th>起点 x1,y1</th><th>终点 x2,y2</th><th>贯穿长度</th></tr>
              </thead>
              <tbody>
                {b.cuts.map((c) => (
                  <tr key={c.seq}>
                    <td>{c.seq}</td>
                    <td>{c.type === 'v' ? '竖切' : '横切'}</td>
                    <td>{strip(c.x1)}, {strip(c.y1)}</td>
                    <td>{strip(c.x2)}, {strip(c.y2)}</td>
                    <td>{strip(c.length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
        );
      })}
    </>
  );
}

/**
 * 刀路执行记录面板（逐板，位于裁切图旁）：
 * 按刀序列出每刀的方向、贯穿长度与直接前置，区分已完成 / 可执行 / 被阻塞；
 * 仅当前置刀已完成才可标记完成（不同分支可交错执行），撤销一刀连带撤销其
 * 已完成的所有后继刀；面板顶部显示该板完成刀数。记录仅存当前页面。
 */
function CutExecPanel({ board, doneSet, statusMap, hint, onMark, onUndo }) {
  const total = board.cuts.length;
  return (
    <div className="cut-exec-panel">
      <h4>
        刀路执行记录
        <span className="cut-exec-count">已完成 {doneSet.size} / {total} 刀</span>
      </h4>
      {total === 0 ? (
        <p className="hint">该板无刀路（零件恰好占满或整板余料），无需执行。</p>
      ) : (
        <ol className="cut-exec-list">
          {board.cuts.map((c) => {
            const st = statusMap[c.seq];
            return (
              <li key={c.seq} className={`cut-exec-row ${st}`}>
                <span className="cut-exec-seq">{c.seq}</span>
                <span className="cut-exec-desc">
                  {c.type === 'v' ? '竖切' : '横切'} · 长 {strip(c.length)}
                </span>
                <span className="cut-exec-pred">
                  {c.pred > 0 ? `前置：第 ${c.pred} 刀` : '前置：整板'}
                </span>
                <span className={`cut-exec-status ${st}`}>
                  {st === 'done' ? '已完成' : st === 'ready' ? '可执行' : '被阻塞'}
                </span>
                {st === 'done' ? (
                  <button type="button" className="btn ghost cut-exec-btn"
                    onClick={() => onUndo(c.seq)}>撤销</button>
                ) : (
                  <button type="button" className={`btn cut-exec-btn ${st === 'ready' ? 'primary' : 'blocked'}`}
                    onClick={() => onMark(c.seq)}>标记完成</button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {hint && <p className="cut-exec-hint" role="status">{hint}</p>}
    </div>
  );
}

/**
 * 可回收余料清单：展示各板最终空闲矩形中实际可取走的余料
 * （已扣除零件占位与锯缝，区域互不重叠），按可配置的最小长 / 宽筛选；
 * 勾选后一键追加到左侧「临时余板库存」表单用于下一次排料，
 * 编号冲突自动避让，同一方案重复操作不重复追加；当前方案落位与分摊不变。
 */
function OffcutSection({ result, selected, added, onToggle, onToggleAll, onAppend }) {
  const offcuts = result.offcuts || [];
  const selectable = offcuts.filter((oc) => !added.has(oc.id));
  const selectedCount = selectable.filter((oc) => selected.has(oc.id)).length;
  const allChecked = selectable.length > 0 && selectedCount === selectable.length;
  const filtered = result.minOffcutLength > 0 || result.minOffcutWidth > 0;
  return (
    <div className="offcut-section">
      <h2 className="section-title">可回收余料清单（{offcuts.length}）</h2>
      <p className="hint">
        从每张板<b>最终的空闲矩形</b>提取实际可取走的余料：已扣除零件占位与锯缝，区域互不重叠。
        {filtered ? (
          <>
            当前筛选：长 ≥ {strip(result.minOffcutLength)} 且 宽 ≥ {strip(result.minOffcutWidth)}
            （允许旋转 90° 匹配）；
          </>
        ) : '未设置最小尺寸筛选，列出全部空闲余料；'}
        编号 = B来源板号-R区域序号。勾选后一键追加到左侧「临时余板库存」，
        下一次生成方案时自动参与排料；编号与现有余板重复时自动避让，
        同一方案重复追加不会重复入库；当前方案的落位与材料费分摊不受影响。
      </p>
      {offcuts.length === 0 ? (
        <p className="hint">没有满足最小尺寸要求的可回收余料。</p>
      ) : (
        <>
          <table className="detail-table offcut-table">
            <thead>
              <tr>
                <th className="sel-col">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={onToggleAll}
                    disabled={selectable.length === 0}
                    title="全选 / 取消全选（不含已追加）"
                  />
                </th>
                <th>余料编号</th><th>来源板号</th><th>位置 x,y</th><th>尺寸 长×宽</th><th>面积</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              {offcuts.map((oc) => {
                const isAdded = added.has(oc.id);
                const checked = selected.has(oc.id);
                return (
                  <tr key={oc.id} className={checked && !isAdded ? 'row-selected' : ''}>
                    <td className="sel-col">
                      <input
                        type="checkbox"
                        checked={isAdded ? false : checked}
                        disabled={isAdded}
                        onChange={() => onToggle(oc.id)}
                        title={isAdded ? '已追加到临时余板库存' : '选择该余料'}
                      />
                    </td>
                    <td>{oc.id}</td>
                    <td><span className="board-num">{oc.board}</span></td>
                    <td>{strip(oc.x)}, {strip(oc.y)}</td>
                    <td>{strip(oc.w)} × {strip(oc.h)}</td>
                    <td>{fmt(oc.area)}</td>
                    <td>
                      {isAdded
                        ? <span className="stock-tag used">已追加</span>
                        : <span className="stock-tag">待回收</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">
            合计 {offcuts.length} 块，可回收余料面积 {fmt(result.offcutArea)}；
            已追加 {offcuts.length - selectable.length} 块。
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={selectedCount === 0}
            onClick={onAppend}
          >
            追加选中余料到临时余板库存（已选 {selectedCount} 块）
          </button>
        </>
      )}
    </div>
  );
}

/**
 * 缺件补切区块：提交选中损坏件 → 展示补切清单（原板号 → 新板号）、
 * 新增板数与材料费、补切板图与刀序。原方案落位与分摊不受影响。
 */
function RecutSection({ selectedCount, recut, error, loading, onSubmit }) {
  return (
    <div className="recut-section">
      <h2 className="section-title">缺件补切</h2>
      <p className="hint">
        在上方「分单取件清单」勾选损坏件（按订单号 + 零件名 + 件号三元身份区分，跨订单同名零件互不影响）。
        提交时以当前排料输入重新计算原方案并校验所选件；仅所选件按原始尺寸与原输入顺序
        合并重排为独立补切方案，<b>补切只开标准新板、不耗用临时余板库存</b>，
        <b>原方案落位与材料费分摊保持不变</b>。
      </p>
      <button
        type="button"
        className="btn primary"
        disabled={selectedCount === 0 || loading}
        onClick={onSubmit}
      >
        {loading ? '正在计算补切方案…' : `生成补切方案（已选 ${selectedCount} 件）`}
      </button>

      {error && (
        <div className="alert" role="alert">
          <strong>无法补切：</strong>{error}
        </div>
      )}

      {recut && <RecutResult recut={recut} />}
    </div>
  );
}

function RecutResult({ recut }) {
  return (
    <div className="recut-result">
      <div className="stat-grid">
        <div className="stat"><b>{recut.damagedCount}</b><span>补切件数</span></div>
        <div className="stat accent"><b>{recut.addedBoards}</b><span>新增板数</span></div>
        <div className="stat accent"><b>¥{yuan(recut.addedMaterialCents)}</b><span>新增材料费</span></div>
        <div className="stat"><b>{fmt(recut.partsArea)}</b><span>补切零件面积</span></div>
        <div className="stat"><b>{recut.utilization}%</b><span>补切利用率</span></div>
      </div>
      <p className="hint">
        {recut.maxCutLength != null ? (
          <>
            <b>设备最大单刀长度上限：{strip(recut.maxCutLength)}</b>
            （与原方案相同；补切板所有刀长均不超过该值，实际最长刀长见各板统计）。
          </>
        ) : '未设置设备最大单刀长度，补切排料同样不限制单刀长度。'}
      </p>

      {/* 补切清单：逐件关联原板号与新板号 */}
      <h3 className="recut-subtitle">补切清单（逐件关联原板号 → 新板号）</h3>
      <table className="detail-table">
        <thead>
          <tr>
            <th>订单</th><th>零件件号</th><th>原板号</th><th>新板号</th>
            <th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th>
          </tr>
        </thead>
        <tbody>
          {recut.items.map((it, i) => (
            <tr key={i} className={i > 0 && it.board !== recut.items[i - 1].board ? 'board-start' : ''}>
              <td>{it.order}</td>
              <td>{it.part} #{it.index}</td>
              <td><span className="board-num old">{it.srcBoard}</span></td>
              <td><span className="board-num">{it.board}</span></td>
              <td>{strip(it.x)}, {strip(it.y)}</td>
              <td>{strip(it.w)} × {strip(it.h)}</td>
              <td>{it.rotated ? '是' : '否'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 补切材料费按订单分摊 */}
      {recut.orders.length > 0 && (
        <>
          <h3 className="recut-subtitle">补切材料费分摊</h3>
          <table className="detail-table">
            <thead>
              <tr><th>订单号</th><th>补切件数</th><th>零件面积</th><th>所在新板号</th><th>分摊（元）</th></tr>
            </thead>
            <tbody>
              {recut.orders.map((o) => (
                <tr key={o.order}>
                  <td>{o.order}</td>
                  <td>{o.partsCount}</td>
                  <td>{fmt(o.partsArea)}</td>
                  <td>{o.boardIndices.join('、')}</td>
                  <td>¥{yuan(o.materialCents)}</td>
                </tr>
              ))}
              <tr className="sum-row">
                <td>合计</td>
                <td>{recut.damagedCount}</td>
                <td>{fmt(recut.partsArea)}</td>
                <td>{recut.addedBoards} 张新板</td>
                <td>¥{yuan(recut.addedMaterialCents)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {/* 补切板图与刀序 */}
      {recut.boards.map((b) => (
        <div className="board-card recut-board" key={b.index}>
          <h3>
            补切标准新板 第 {b.index} 张 / 共 {recut.addedBoards} 张
            <span className="board-kind standard">{strip(b.width)} × {strip(b.height)}（独立补切，不耗用余板库存）</span>
            <span className="board-price">板价 ¥{yuan(b.cost.priceCents)}</span>
          </h3>
          <BoardDiagram board={b} boardWidth={b.width} boardHeight={b.height} />
          <div className="board-stats">
            <span>零件 {fmt(b.partsArea)}</span>
            <span>锯缝 {fmt(b.kerfArea)}</span>
            <span>余料 {fmt(b.remainderArea)}</span>
            <span>利用率 {b.utilization}%</span>
            <span>{b.cuts.length} 刀</span>
            {recut.maxCutLength != null && (
              <span className="cut-limit">实际最长刀 {strip(b.longestCut)} / 上限 {strip(recut.maxCutLength)}</span>
            )}
          </div>

          {b.cost.shares.length > 0 && (
            <table className="detail-table cost-table">
              <thead>
                <tr><th>本板材料费分摊</th><th>零件面积</th><th>面积占比</th><th>分摊额（元）</th></tr>
              </thead>
              <tbody>
                {b.cost.shares.map((s) => (
                  <tr key={s.order}>
                    <td>订单 {s.order}</td>
                    <td>{fmt(s.area)}</td>
                    <td>{s.ratio}%</td>
                    <td>¥{yuan(s.cents)}</td>
                  </tr>
                ))}
                <tr className="sum-row">
                  <td>合计</td>
                  <td>{fmt(b.partsArea)}</td>
                  <td>100%</td>
                  <td>¥{yuan(b.cost.priceCents)}</td>
                </tr>
              </tbody>
            </table>
          )}

          <details>
            <summary>查看补切落位与切割次序明细</summary>
            <table className="detail-table">
              <thead>
                <tr><th>订单</th><th>零件</th><th>件号</th><th>原板号</th><th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th></tr>
              </thead>
              <tbody>
                {b.placements.map((p, i) => (
                  <tr key={i}>
                    <td>{p.order}</td>
                    <td>{p.part}</td>
                    <td>#{p.index}</td>
                    <td>{p.srcBoard}</td>
                    <td>{strip(p.x)}, {strip(p.y)}</td>
                    <td>{strip(p.w)} × {strip(p.h)}</td>
                    <td>{p.rotated ? '是' : '否'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="detail-table">
              <thead>
                <tr><th>刀序</th><th>方向</th><th>起点 x1,y1</th><th>终点 x2,y2</th><th>贯穿长度</th></tr>
              </thead>
              <tbody>
                {b.cuts.map((c) => (
                  <tr key={c.seq}>
                    <td>{c.seq}</td>
                    <td>{c.type === 'v' ? '竖切' : '横切'}</td>
                    <td>{strip(c.x1)}, {strip(c.y1)}</td>
                    <td>{strip(c.x2)}, {strip(c.y2)}</td>
                    <td>{strip(c.length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ))}
    </div>
  );
}

/**
 * 撤单影响预览区块：选择一张订单 → 以生成方案时的输入快照分别计算撤单前后排料，
 * 展示前后新增标准板数、已用余板编号、材料费总额，以及每张保留订单的分摊额与增减差值。
 * 原方案与表单保持不变。
 */
function CancelPreviewSection({ orders, cancelOrder, onSelectOrder, preview, error, loading, onSubmit }) {
  return (
    <div className="cancel-section">
      <h2 className="section-title">撤单影响预览</h2>
      <p className="hint">
        在已生成的方案中选择一张订单，系统以<b>生成该方案时的输入快照</b>分别计算撤单前、
        撤单后两套排料（沿用相同切割规则），对比新增标准板数、已用余板编号与材料费分摊变化；
        <b>原方案与表单保持不变</b>。订单号空白的订单已按原位置固定自动编号，
        撤单后其余订单保持原名。
      </p>
      {orders.length < 2 ? (
        <p className="hint">当前方案只有一张订单，无法进行撤单预览（至少保留一张订单）。</p>
      ) : (
        <div className="cancel-controls">
          <label>
            选择要撤单的订单
            <select value={cancelOrder} onChange={(e) => onSelectOrder(e.target.value)}>
              {orders.map((o) => (
                <option key={o.order} value={o.order}>{o.order}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={!cancelOrder || loading}
            onClick={onSubmit}
          >
            {loading ? '正在计算撤单预览…' : `预览撤单影响（${cancelOrder}）`}
          </button>
        </div>
      )}

      {error && (
        <div className="alert" role="alert">
          <strong>无法预览撤单：</strong>{error}
        </div>
      )}

      {preview && <CancelPreviewResult preview={preview} />}
    </div>
  );
}

function CancelPreviewResult({ preview }) {
  const { before, after, diff } = preview;
  const stockText = (ids) => (ids.length ? ids.join('、') : '无');
  return (
    <div className="cancel-result">
      <div className="stat-grid">
        <div className="stat">
          <b>{before.standardBoardsCount} → {after.standardBoardsCount}</b>
          <span>
            新增标准板数（{diff.standardBoards === 0 ? '不变' : `差值 ${signedInt(diff.standardBoards)}`}）
          </span>
        </div>
        <div className="stat accent">
          <b>¥{yuan(before.totalMaterialCents)} → ¥{yuan(after.totalMaterialCents)}</b>
          <span>
            材料费总额（差值 <DeltaCents cents={diff.totalMaterialCents} />）
          </span>
        </div>
        <div className="stat">
          <b>{stockText(before.stockUsed)}</b>
          <span>撤单前已用余板编号</span>
        </div>
        <div className="stat">
          <b>{stockText(after.stockUsed)}</b>
          <span>撤单后已用余板编号</span>
        </div>
      </div>
      <p className="hint">
        撤单订单 <b>{preview.cancelOrder}</b>（撤单前分摊 ¥{yuan(preview.cancelled.beforeCents)}）；
        撤单后用板总数 {before.boardsCount} → {after.boardsCount} 张。
        {diff.stockUsedAdded.length > 0 && <>撤单后新增启用余板：{diff.stockUsedAdded.join('、')}。</>}
        {diff.stockUsedRemoved.length > 0 && <>撤单后不再使用余板：{diff.stockUsedRemoved.join('、')}。</>}
        差值 = 撤单后 − 撤单前，费用差值按整数分计算。
      </p>

      <h3 className="cancel-subtitle">保留订单材料费分摊对照</h3>
      <table className="detail-table">
        <thead>
          <tr><th>订单号</th><th>撤单前分摊（元）</th><th>撤单后分摊（元）</th><th>增减差值（元）</th></tr>
        </thead>
        <tbody>
          {preview.orders.map((o) => (
            <tr key={o.order}>
              <td>{o.order}</td>
              <td>¥{yuan(o.beforeCents)}</td>
              <td>¥{yuan(o.afterCents)}</td>
              <td><DeltaCents cents={o.deltaCents} /></td>
            </tr>
          ))}
          <tr className="sum-row">
            <td>合计（不含撤单订单）</td>
            <td>¥{yuan(preview.orders.reduce((s, o) => s + o.beforeCents, 0))}</td>
            <td>¥{yuan(preview.orders.reduce((s, o) => s + o.afterCents, 0))}</td>
            <td><DeltaCents cents={preview.orders.reduce((s, o) => s + o.deltaCents, 0)} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * 连续批次用料预演结果区块：按保存顺序逐批展示新开标准板数、已用 / 新增余板、
 * 批末库存与累计材料费；某批无法加工时后端指出批次并停止，不返回部分结果。
 * 预演为只读评估，不改动表单与单次排料结果。
 */
function BatchPreviewSection({ result, error }) {
  return (
    <div className="batch-section">
      <h2 className="section-title">连续批次用料预演</h2>
      {error && (
        <div className="alert" role="alert">
          <strong>预演中止：</strong>{error}
        </div>
      )}
      {result && <BatchPreviewResult result={result} />}
    </div>
  );
}

function BatchPreviewResult({ result }) {
  return (
    <div className="batch-result">
      <div className="stat-grid">
        <div className="stat"><b>{result.batchesCount}</b><span>连续批次数</span></div>
        <div className="stat accent"><b>{result.totalStandardBoards}</b><span>新开标准板总数</span></div>
        <div className="stat accent"><b>¥{yuan(result.totalMaterialCents)}</b><span>累计材料费（全部批次）</span></div>
        <div className="stat"><b>{result.finalPool.length}</b><span>最终余板库存</span></div>
      </div>
      <p className="hint">
        按保存顺序逐批排料：首批表单余板为初始库存；每批从余板池扣除已用编号、保留未用余板，
        本批符合回收尺寸的余料以「P批次号-原余料编号」入池供后续批次使用（跨批编号不冲突）；
        材料费只计新开标准板并逐批累计。预演不改动表单与单次排料结果。
      </p>

      {result.batches.map((b) => (
        <div className="board-card batch-card" key={b.batch}>
          <h3>
            第 {b.batch} 批 / 共 {result.batchesCount} 批
            <span className="board-kind standard">
              {b.ordersCount} 张订单 · {fmt(b.totalParts)} 件 · 用板 {b.boardsCount} 张
            </span>
            <span className="board-kind standard">
              板 {strip(b.boardWidth)} × {strip(b.boardHeight)} · 板价 ¥{yuan(b.boardPrice * 100)}
            </span>
          </h3>
          <div className="stat-grid">
            <div className="stat accent"><b>{b.standardBoardsCount}</b><span>本批新开标准板</span></div>
            <div className="stat"><b>{b.stockUsed.length}</b><span>已用余板（批初库存 {b.poolBeforeCount}）</span></div>
            <div className="stat"><b>{b.stockAdded.length}</b><span>新增余板入池</span></div>
            <div className="stat"><b>{b.poolAfter.length}</b><span>批末库存</span></div>
            <div className="stat"><b>¥{yuan(b.materialCents)}</b><span>本批材料费</span></div>
            <div className="stat accent"><b>¥{yuan(b.cumulativeMaterialCents)}</b><span>累计材料费</span></div>
          </div>

          <h4 className="batch-subtitle">已用余板（从余板池扣除）</h4>
          {b.stockUsed.length === 0 ? (
            <p className="hint">本批未启用余板。</p>
          ) : (
            <table className="detail-table">
              <thead>
                <tr><th>余板编号</th><th>尺寸 长×宽</th><th>所在板号</th></tr>
              </thead>
              <tbody>
                {b.stockUsed.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{strip(s.width)} × {strip(s.height)}</td>
                    <td><span className="board-num">{s.board}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h4 className="batch-subtitle">新增余板（本批回收入池，供后续批次使用）</h4>
          {b.stockAdded.length === 0 ? (
            <p className="hint">本批没有符合回收尺寸的余料入池。</p>
          ) : (
            <table className="detail-table">
              <thead>
                <tr><th>新编号</th><th>来源余料</th><th>尺寸 长×宽</th></tr>
              </thead>
              <tbody>
                {b.stockAdded.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{s.fromOffcut}（第 {s.fromBoard} 板）</td>
                    <td>{strip(s.width)} × {strip(s.height)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h4 className="batch-subtitle">批末库存（{b.poolAfter.length}）</h4>
          {b.poolAfter.length === 0 ? (
            <p className="hint">批末余板池为空。</p>
          ) : (
            <table className="detail-table">
              <thead>
                <tr><th>余板编号</th><th>尺寸 长×宽</th><th>来源</th></tr>
              </thead>
              <tbody>
                {b.poolAfter.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{strip(s.width)} × {strip(s.height)}</td>
                    <td>{s.fromBatch ? `第 ${s.fromBatch} 批回收（${s.fromOffcut}）` : '初始库存'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      <h3 className="batch-subtitle">最终余板库存（{result.finalPool.length}）</h3>
      {result.finalPool.length === 0 ? (
        <p className="hint">全部批次结束后余板池为空。</p>
      ) : (
        <table className="detail-table">
          <thead>
            <tr><th>余板编号</th><th>尺寸 长×宽</th><th>来源</th></tr>
          </thead>
          <tbody>
            {result.finalPool.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td>{strip(s.width)} × {strip(s.height)}</td>
                <td>{s.fromBatch ? `第 ${s.fromBatch} 批回收（${s.fromOffcut}）` : '初始库存'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * 机台开料排程区块：编辑 2～3 台机台（唯一名称、最大单刀长度、切割速度、每板准备秒数、
 * 运行功率、开工时刻）与一天内的分时电价时段；以生成方案时的输入快照提交，
 * 后端重算同一方案后在机台间分配整板加工并核算分时电费，排料与排程均为只读计算、原结果不变。
 */
function ScheduleSection({
  machines, schedule, error, loading, onUpdate, onAdd, onRemove, onSubmit,
  tariffs, electricity, electricityError, electricityLoading,
  onUpdatePricing, onTariffUpdate, onTariffAdd, onTariffRemove, onSubmitElectricity,
}) {
  return (
    <div className="schedule-section">
      <h2 className="section-title">机台开料排程 · 分时电费核算</h2>
      <p className="hint">
        为上方已生成的裁切方案在 <b>2～3 台机台</b>间分配整板加工（以生成方案时的输入快照重算同一方案，
        <b>原排料结果不变</b>）。每板不可拆分：<b>实际最长刀超过机台最大单刀长度的板不能分配给该机台</b>；
        单板耗时 = 每板准备秒数 + 该板全部刀长之和 ÷ 切割速度；同一机台按板号顺序连续加工。
        系统遍历全部可行分配，取<b>全部板完成时间最小</b>的分配（平局按板号对应的机台输入序号字典序选取）；
        仅接受不超过 8 张板的方案，某板在全部机台上都超限时将指出板号。
      </p>
      <div className="machine-list">
        <div className="part-row part-row-head machine-row">
          <span>机台名称（唯一）</span>
          <span>最大单刀长度</span>
          <span>切割速度 / 秒</span>
          <span>每板准备秒数</span>
          <span>运行功率（千瓦）</span>
          <span>开工时刻</span>
          <span className="op-col"></span>
        </div>
        {machines.map((m, mi) => (
          <div className="part-row machine-row" key={mi}>
            <input type="text" value={m.name} placeholder={`机台${mi + 1}（唯一）`}
              onChange={(e) => onUpdate(mi, 'name', e.target.value)} />
            <input type="number" step="any" min="0" value={m.maxCutLength} placeholder="如 1300"
              onChange={(e) => onUpdate(mi, 'maxCutLength', e.target.value)} />
            <input type="number" step="any" min="0" value={m.speed} placeholder="长度 / 秒"
              onChange={(e) => onUpdate(mi, 'speed', e.target.value)} />
            <input type="number" step="any" min="0" value={m.setupSeconds} placeholder="秒"
              onChange={(e) => onUpdate(mi, 'setupSeconds', e.target.value)} />
            <input type="number" step="any" min="0" value={m.power} placeholder="千瓦 kW"
              onChange={(e) => onUpdatePricing(mi, 'power', e.target.value)} />
            <input type="text" value={m.startTime} placeholder="HH:mm，如 08:00"
              onChange={(e) => onUpdatePricing(mi, 'startTime', e.target.value)} />
            <button type="button" className="btn icon op-col" title="删除该机台"
              onClick={() => onRemove(mi)} disabled={machines.length <= 2}>✕</button>
          </div>
        ))}
        <button type="button" className="btn ghost wide" onClick={onAdd} disabled={machines.length >= 3}>
          ＋ 添加机台（{machines.length}/3）
        </button>
      </div>
      <button type="button" className="btn primary" disabled={loading} onClick={onSubmit}>
        {loading ? '正在排程…' : '计算机台开料排程'}
      </button>

      {error && (
        <div className="alert" role="alert">
          <strong>无法排程：</strong>{error}
        </div>
      )}

      {schedule && <ScheduleResult schedule={schedule} />}

      <div className="tariff-block">
        <h3 className="schedule-subtitle">分时电费核算（运行功率 × 加工时长 × 分时段电价）</h3>
        <p className="hint">
          填写一天内的<b>电价时段</b>（起止时分、元 / 千瓦时）：各时段须<b>无重叠且首尾相接、
          完整覆盖 00:00～24:00</b>（结束时刻可填 24:00），电价为非负数字。
          核算沿用上方排程：把每板起止秒数叠加机台<b>开工时刻</b>换算为实际时刻，
          <b>跨电价边界或午夜时按日循环拆分</b>；分段费用 = 功率 × 加工秒数 ÷ 3600 × 电价，
          <b>每板金额四舍五入到分后再汇总</b>。修改功率、开工时刻或电价时段后可随时重新核算，
          <b>不改变原排料与排程</b>。
        </p>
        <div className="tariff-list">
          <div className="part-row part-row-head tariff-row">
            <span>开始时刻</span>
            <span>结束时刻</span>
            <span>电价（元 / 千瓦时）</span>
            <span className="op-col"></span>
          </div>
          {tariffs.map((t, ti) => (
            <div className="part-row tariff-row" key={ti}>
              <input type="text" value={t.start} placeholder="HH:mm，如 00:00"
                onChange={(e) => onTariffUpdate(ti, 'start', e.target.value)} />
              <input type="text" value={t.end} placeholder="HH:mm，如 08:00 / 24:00"
                onChange={(e) => onTariffUpdate(ti, 'end', e.target.value)} />
              <input type="number" step="any" min="0" value={t.price} placeholder="元 / 度（kWh）"
                onChange={(e) => onTariffUpdate(ti, 'price', e.target.value)} />
              <button type="button" className="btn icon op-col" title="删除该时段"
                onClick={() => onTariffRemove(ti)} disabled={tariffs.length <= 1}>✕</button>
            </div>
          ))}
          <button type="button" className="btn ghost wide" onClick={onTariffAdd} disabled={tariffs.length >= 48}>
            ＋ 添加电价时段（{tariffs.length}/48）
          </button>
        </div>
        <button type="button" className="btn primary tariff-submit" disabled={electricityLoading}
          onClick={onSubmitElectricity}>
          {electricityLoading ? '正在核算电费…' : '按分时电价核算电费'}
        </button>

        {electricityError && (
          <div className="alert" role="alert">
            <strong>无法核算：</strong>{electricityError}
          </div>
        )}

        {electricity && <ElectricityResult electricity={electricity} />}
      </div>
    </div>
  );
}

function ScheduleResult({ schedule }) {
  return (
    <div className="schedule-result">
      <div className="stat-grid">
        <div className="stat"><b>{schedule.machines.length}</b><span>机台数</span></div>
        <div className="stat"><b>{schedule.boardsCount}</b><span>排程板数（每板不可拆分）</span></div>
        <div className="stat accent"><b>{strip(schedule.makespan)} 秒</b><span>总完工时间（全部板完成）</span></div>
      </div>

      <h3 className="schedule-subtitle">逐板排程（板号 → 机台，起止秒数）</h3>
      <table className="detail-table">
        <thead>
          <tr>
            <th>板号</th><th>机台</th><th>刀长合计</th><th>实际最长刀</th>
            <th>单板耗时（秒）</th><th>开始（秒）</th><th>结束（秒）</th>
          </tr>
        </thead>
        <tbody>
          {schedule.boards.map((b) => (
            <tr key={b.board}>
              <td><span className="board-num">{b.board}</span></td>
              <td>{b.machine}</td>
              <td>{strip(b.cutLength)}</td>
              <td>{strip(b.longestCut)}</td>
              <td>{strip(b.duration)}</td>
              <td>{strip(b.start)}</td>
              <td>{strip(b.end)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="schedule-subtitle">机台完工汇总</h3>
      <table className="detail-table">
        <thead>
          <tr>
            <th>机台</th><th>最大单刀长度</th><th>切割速度 / 秒</th><th>每板准备秒数</th>
            <th>加工板号（按板号顺序连续加工）</th><th>完工（秒）</th>
          </tr>
        </thead>
        <tbody>
          {schedule.machines.map((m) => (
            <tr key={m.index}>
              <td>{m.name}</td>
              <td>{strip(m.maxCutLength)}</td>
              <td>{strip(m.speed)}</td>
              <td>{strip(m.setupSeconds)}</td>
              <td>{m.boards.length ? m.boards.join('、') : '—（未分配）'}</td>
              <td>{strip(m.end)}</td>
            </tr>
          ))}
          <tr className="sum-row">
            <td>总完工</td>
            <td colSpan={4}>全部板完成时间 = 各机台完工秒数的最大值</td>
            <td>{strip(schedule.makespan)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// 相对开工当日的天序号 → 中文前缀：0 当日不加、1 次日、其余「第 N 日」
function dayPrefix(day) {
  if (day === 0) return '';
  if (day === 1) return '次日 ';
  return `第 ${day + 1} 日 `;
}
// 带天序号的实际时刻
function clockText(day, time) {
  return `${dayPrefix(day)}${time}`;
}
// 用电量（kWh，最多 6 位小数）
function kwhText(v) {
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
}
// 分段费用（元，未取整，最多 4 位小数）
function segYuan(v) {
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function ElectricityResult({ electricity }) {
  return (
    <div className="electricity-result">
      <div className="stat-grid">
        <div className="stat"><b>{electricity.boardsCount}</b><span>核算板数</span></div>
        <div className="stat"><b>{kwhText(electricity.totalKwh)} 度</b><span>总用电量（千瓦时）</span></div>
        <div className="stat accent"><b>¥{yuan(electricity.totalCents)}</b><span>总电费（逐板四舍五入到分后汇总）</span></div>
      </div>

      <h3 className="schedule-subtitle">逐板用电量与电费（起止秒数已按机台开工时刻换算为实际时刻）</h3>
      <table className="detail-table">
        <thead>
          <tr>
            <th>板号</th><th>机台</th>
            <th>开始时刻</th><th>结束时刻</th><th>加工秒数</th>
            <th>用电量（度）</th><th>电费（元）</th><th>分段明细（跨边界 / 午夜按日循环）</th>
          </tr>
        </thead>
        <tbody>
          {electricity.boards.map((b) => (
            <tr key={b.board}>
              <td><span className="board-num">{b.board}</span></td>
              <td>{b.machine}</td>
              <td className="clock-cell">{clockText(b.startDay, b.startTime)}</td>
              <td className="clock-cell">{clockText(b.endDay, b.endTime)}</td>
              <td>{strip(b.end - b.start)}</td>
              <td>{kwhText(b.kwh)}</td>
              <td className="money-cell">¥{yuan(b.costCents)}</td>
              <td className="seg-cell">
                {b.segments.map((sg, si) => (
                  <div className="seg-line" key={si}>
                    {clockText(sg.startDay, sg.startTime)} → {clockText(sg.endDay, sg.endTime)}
                    （{strip(sg.seconds)} 秒 × {strip(sg.kwh)} 度 @ {sg.priceRate} 元/度）
                    <b>¥{segYuan(sg.price)}</b>
                  </div>
                ))}
              </td>
            </tr>
          ))}
          <tr className="sum-row">
            <td colSpan={5}>合计</td>
            <td>{kwhText(electricity.totalKwh)}</td>
            <td>¥{yuan(electricity.totalCents)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <h3 className="schedule-subtitle">逐机台电费汇总</h3>
      <table className="detail-table">
        <thead>
          <tr>
            <th>机台</th><th>运行功率（千瓦）</th><th>开工时刻</th>
            <th>加工板号</th><th>完工时刻</th><th>用电量（度）</th><th>电费（元）</th>
          </tr>
        </thead>
        <tbody>
          {electricity.machines.map((m) => (
            <tr key={m.index}>
              <td>{m.name}</td>
              <td>{kwhText(m.power)}</td>
              <td className="clock-cell">{m.startTime}</td>
              <td>{m.boards.length ? m.boards.join('、') : '—（未分配）'}</td>
              <td className="clock-cell">
                {m.boards.length ? clockText(m.finishDay, m.finishTime) : '—'}
              </td>
              <td>{kwhText(m.kwh)}</td>
              <td className="money-cell">¥{yuan(m.costCents)}</td>
            </tr>
          ))}
          <tr className="sum-row">
            <td colSpan={5}>总电费（逐板整数分汇总）</td>
            <td>{kwhText(electricity.totalKwh)}</td>
            <td>¥{yuan(electricity.totalCents)}</td>
          </tr>
        </tbody>
      </table>
      <p className="hint">
        本次电价时段：
        {electricity.tariffs.map((t) => `${t.start}～${t.end} @ ${t.price} 元/度`).join('；')}。
        核算为只读计算：修改功率、开工时刻或电价时段后重新核算即可，<b>原排料与排程保持不变</b>。
      </p>
    </div>
  );
}

// 费用差值（整数分）：正数红色、负数绿色、零为中性
function DeltaCents({ cents }) {  const cls = cents > 0 ? 'delta-pos' : cents < 0 ? 'delta-neg' : 'delta-zero';
  return <span className={`delta ${cls}`}>{signedYuan(cents)}</span>;
}

function legendKeys(result) {  const seen = new Set();
  const keys = [];
  result.boards.forEach((b) => b.placements.forEach((p) => {
    const k = `${p.order}⟂${p.part}`;
    if (!seen.has(k)) {
      seen.add(k);
      keys.push({ order: p.order, part: p.part });
    }
  }));
  return keys;
}

// 已保存批次快照中的零件总件数（用于批次列表摘要）
function batchPartCount(b) {
  return b.orders.reduce((s, o) => s + o.parts.reduce((t, p) => t + (Number(p.quantity) || 0), 0), 0);
}

// 后端金额以整数“分”返回
function yuan(cents) {
  return (Number(cents || 0) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
// 带符号金额（分）：+¥1.23 / -¥4.56 / ¥0.00
function signedYuan(cents) {
  const n = Number(cents || 0);
  if (n === 0) return '¥0.00';
  return `${n > 0 ? '+' : '-'}¥${yuan(Math.abs(n))}`;
}
function signedInt(n) {
  return n > 0 ? `+${n}` : String(n);
}
function fmt(n) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
function strip(n) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}
