'use strict';

/**
 * 断头切割 (guillotine cut) 排料算法 —— 多订单拼版 & 缺件补切
 *
 * 规则：
 *  - 坐标原点在左上角，x 向右、y 向下，单位与输入一致（通常为 mm）。
 *  - 零件按“订单输入顺序 → 订单内零件行顺序 → 数量 n 连续 n 件”展开，不做大小重排；
 *    不同订单允许使用同名零件，落位结果保留订单归属。
 *  - 每件零件允许旋转 90°；在余量相同的情况下优先不旋转。
 *  - 每件零件放入某个当前可用矩形区域的左上角，释放该零件需要：
 *      * 竖切方案：先沿零件右边竖切一刀（贯穿该区域全高），再在左侧余料上横切一刀；
 *      * 横切方案：先沿零件下边横切一刀（贯穿该区域全宽），再在上侧余料上竖切一刀。
 *    两种方案中，锯缝宽度均从“余料一侧”扣除，选择锯缝损失更小的方案，平局取竖切。
 *  - 每一刀都贯穿其所在的当前矩形区域；沿板材边缘的修整切也会被记录（缝宽可能小于
 *    标准锯缝，因为余边不足一条完整锯缝）。零件恰好占满方向时不产生该方向的刀。
 *  - 零件在所有已开板材上都放不下时，先按输入顺序尝试尚未使用、且能加工该件的余板库存，
 *    仍无可行落位时才开启标准新板；全部板材均无法容纳的零件直接报错。
 *    每块余板最多使用一次（开启即从库存中消耗），余板与新板遵守同样的锯缝 / 旋转 / 单刀规则。
 *  - 可选设备最大单刀长度 maxCutLength（留空 = 不限制）：在每个候选落位与朝向下分别
 *    计算竖切优先、横切优先两种切法中各刀的实际刀长，仅当一种切法的所有刀长均不超过
 *    上限时该切法才可行；再从可行切法中按现有规则（余料面积 / 评分）选取。现有板无可行
 *    落位时仍尝试新板，新板也无法加工则报错指出订单、零件与件号，绝不输出超限刀路。
 *
 * 材料费分摊：
 *  - 输入每张原板材料价 boardPrice（非负、最多两位小数，内部按“分”整数计算）。
 *  - 每张板按“各订单在该板上的零件实际面积”比例分摊该板板价：
 *    先各订单取 floor（分），尾差按最大余数法逐分补入；余数相同按订单输入顺序。
 *  - 因此每板各订单分摊额之和严格等于该板板价，订单汇总严格等于总板价。
 *
 * 缺件补切（recutBoards）：
 *  - 以当前排料输入重新计算原方案（落位与分摊保持原样输出，不受补切影响）；
 *  - 按“订单号 + 零件名 + 件号”三元身份选择损坏件（跨订单同名零件互不影响），
 *    校验所选件存在且无重复；
 *  - 仅将所选件按原始尺寸与原输入顺序（订单 → 零件行 → 件号）合并，
 *    重排为独立的补切方案（新增板单独计费），不改动原方案任何落位；
 *  - 补切清单逐件关联原板号与新板号，并给出新增板数与新增材料费。
 *
 * 撤单影响预览（cancelPreviewBoards）：
 *  - 以生成方案时的同一份输入快照分别计算撤单前、撤单后两套排料，原方案本身不变；
 *  - 按订单号定位撤单对象；订单号空白时先按原输入位置固定自动编号（订单1、订单2…），
 *    筛除撤单订单后其余订单保持原名（不重新编号）；
 *  - 输出前后新增标准板数、已用余板编号、材料费总额（整数分），
 *    以及每张保留订单的分摊额与增减差值（整数分）；
 *  - 只有一张订单或订单号无效时明确报错。
 *
 * 可回收余料清单（offcuts）：
 *  - 排料结束后，从每张板最终的空闲矩形（free）提取实际可取走的余料：
 *    空闲矩形已扣除零件占位与锯缝带，彼此互不重叠，面积之和即该板余料面积；
 *  - minOffcutLength / minOffcutWidth 为可配置的最小回收尺寸（留空或 0 = 不筛选）：
 *    余料按当前朝向或旋转 90° 后满足 长 ≥ 最小长度 且 宽 ≥ 最小宽度 即视为可回收；
 *  - 每项给出编号、来源板号、坐标、尺寸与面积；编号为 B{来源板号}-R{区域序号}，
 *    区域序号为该板最终空闲区域的顺序号（从 1 起），未通过筛选的区域保留序号但
 *    不进入清单，因此同一区域在不同筛选条件下编号稳定；
 *  - 清单只是对排料结果的只读提取，落位与材料费分摊不受影响。
 *
 * 连续批次用料预演（batchPreviewBoards）：
 *  - 输入 { batches: [排料输入, ...] }：每批为保存时的表单快照（订单 + 板材参数），
 *    按保存顺序逐批调用与 cutBoards 完全相同的排料规则；
 *  - 首批快照的 stockBoards 作为初始余板池；后续各批自带的 stockBoards 不再入池，
 *    统一从上一批留下的余板池取料；
 *  - 每批结束后从池中扣除已用余板编号、保留未用余板，再把本批符合回收尺寸的余料
 *    （该批 offcuts 清单）以「P批次号-原余料编号」入池供后续批次使用，
 *    与历史编号冲突时自动追加 -2、-3… 后缀，全程编号不重复；
 *  - 逐批输出新开标准板数、已用 / 新增余板、批末库存与累计材料费；
 *  - 任一批无法加工时报错指出批次并停止，不返回任何批次结果；预演不改动输入快照。
 *
 * 机台开料排程（scheduleBoards）：
 *  - 以生成方案时的输入快照重算裁切方案（原排料结果不变），仅接受不超过 8 张板的方案，
 *    超出时明确报错；
 *  - 输入 2～3 台机台（唯一名称、最大单刀长度、切割速度、每板准备秒数），每板不可拆分：
 *    板的实际最长刀超过机台上限则不能分配给该机台，全部机台都超限时指出板号；
 *  - 单板耗时 = 每板准备秒数 + 该板全部刀长之和 ÷ 切割速度；同一机台按板号顺序连续加工；
 *  - 遍历全部可行分配，取全部板完成时间最小者，平局按板号对应的机台输入序号字典序选取。
 *
 * 分时电费核算（electricityBoards）：
 *  - 沿用机台排程的同一输入快照与机台参数重算同一排程（原排料与原排程不变），
 *    机台额外填写运行功率（千瓦，非负）与开工时刻（HH:mm），并给出一天内的电价时段
 *    （起止时分、元 / 千瓦时；时段无重叠且完整覆盖 00:00～24:00，电价非负）；
 *  - 每板起止秒数叠加该机台开工时刻换算为实际时钟时刻；跨电价边界或午夜时按日循环拆分；
 *  - 分段费用 = 功率 × 加工秒数 ÷ 3600 × 电价；每板费用四舍五入到分后再汇总；
 *  - 输出逐板用电量与电费、逐机台电费与总电费；只改计价参数即可重新核算，不改变排料与排程。
 *
 * 刀路执行前置（每刀 pred 字段）：
 *  - 排料结束后，对每张板用未舍入几何按现有刀序回放矩形切分：初始为整板（无前置），
 *    每刀在其当前所在矩形内贯穿，扣除该刀实际锯缝带后，剩余矩形记为由该刀产生；
 *  - 每刀的直接前置 = 所切矩形的产生刀（0 表示所切的是初始整板、无前置）；
 *  - 前置关系只是对既有刀路的只读回放，落位、分摊与排程均不受影响；
 *    零锯缝（缝带宽度为 0）、余板尺寸与无刀板同样适用。
 */

const EPS = 1e-9;

class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.statusCode = 400;
  }
}

function num(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new UserError(`${field} 必须是数字`);
  }
  return n;
}

function positiveInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new UserError(`${field} 必须是不小于 1 的整数`);
  }
  return n;
}

/**
 * 解析每张原板材料价：非负、最多两位小数，返回整数“分”。
 */
function priceToCents(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new UserError('每张原板材料价必须是非负数字，最多两位小数');
  }
  const cents = Math.round(n * 100);
  if (Math.abs(cents / 100 - n) > 1e-7) {
    throw new UserError('每张原板材料价最多保留两位小数');
  }
  return cents;
}

/**
 * 解析设备最大单刀长度：留空（undefined / null / ''）返回 null，表示不限制，
 * 沿用现有排料规则；填写时必须为正数。
 */
function parseMaxCutLength(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new UserError('设备最大单刀长度必须是正数（留空则不限制）');
  }
  return n;
}

/**
 * 解析可回收余料的最小回收尺寸（最小长度 / 最小宽度）：
 * 留空（undefined / null / ''）或 0 返回 0，表示不筛选、列出全部空闲余料；
 * 填写时必须为非负数字。
 */
function parseMinOffcut(value, field) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new UserError(`${field}必须是非负数字（留空则不筛选）`);
  }
  return n;
}

/**
 * 解析临时余板库存 stockBoards：[{ id, width, height }]
 *  - id 为必填的唯一编号（去空白后非空、不可重复）；
 *  - 长 / 宽均必须为正数，单位与标准板一致；
 *  - 省略或传非数组均视为空库存。
 * 返回 [{ id, width, height }]，按输入顺序排列。
 */
function parseStockBoards(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new UserError('临时余板库存格式不正确');
  }
  if (value.length > 500) {
    throw new UserError('余板数量过多（最多 500 块）');
  }
  const stocks = [];
  const usedIds = new Set();
  value.forEach((s, i) => {
    if (!s || typeof s !== 'object') {
      throw new UserError(`第 ${i + 1} 块余板格式不正确`);
    }
    const id = s.id === undefined || s.id === null ? '' : String(s.id).trim();
    if (!id) {
      throw new UserError(`第 ${i + 1} 块余板缺少唯一编号`);
    }
    if (usedIds.has(id)) {
      throw new UserError(`余板编号重复：${id}`);
    }
    const w = num(s.width, `余板「${id}」的长度`);
    const h = num(s.height, `余板「${id}」的宽度`);
    if (w <= 0) throw new UserError(`余板「${id}」的长度必须大于 0`);
    if (h <= 0) throw new UserError(`余板「${id}」的宽度必须大于 0`);
    usedIds.add(id);
    stocks.push({ id, width: w, height: h });
  });
  return stocks;
}

/**
 * 解析机台清单 machines：[{ name, maxCutLength, speed, setupSeconds, power?, startTime? }]
 *  - 2～3 台；name 为去空白后非空且全表唯一的名称；
 *  - maxCutLength（最大单刀长度）与 speed（切割速度，长度 / 秒）均必须为正数；
 *  - setupSeconds（每板准备秒数）必须为非负数字；
 *  - withPower=true（分时电费核算）时还要求：
 *    power（运行功率，千瓦）必须为非负数字；startTime（开工时刻 HH:mm，00:00～23:59）
 *    必须为合法时刻，返回其自当日 00:00 起的分钟数 startMinute（0～1439）。
 * 返回 [{ name, maxCutLength, speed, setupSeconds, power?, startMinute? }]，按输入顺序排列
 * （输入序号从 1 起）。
 */
function parseMachines(value, withPower = false) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    throw new UserError('机台开料排程需要 2～3 台机台');
  }
  const machines = [];
  const usedNames = new Set();
  value.forEach((m, i) => {
    if (!m || typeof m !== 'object') {
      throw new UserError(`第 ${i + 1} 台机台格式不正确`);
    }
    const name = m.name === undefined || m.name === null ? '' : String(m.name).trim();
    if (!name) {
      throw new UserError(`第 ${i + 1} 台机台缺少唯一名称`);
    }
    if (usedNames.has(name)) {
      throw new UserError(`机台名称重复：${name}`);
    }
    usedNames.add(name);
    const maxCutLength = num(m.maxCutLength, `机台「${name}」的最大单刀长度`);
    if (maxCutLength <= 0) throw new UserError(`机台「${name}」的最大单刀长度必须大于 0`);
    const speed = num(m.speed, `机台「${name}」的切割速度`);
    if (speed <= 0) throw new UserError(`机台「${name}」的切割速度必须大于 0`);
    const setupSeconds = num(m.setupSeconds, `机台「${name}」的每板准备秒数`);
    if (setupSeconds < 0) throw new UserError(`机台「${name}」的每板准备秒数不能为负数`);
    const machine = { name, maxCutLength, speed, setupSeconds };
    if (withPower) {
      const power = num(m.power, `机台「${name}」的运行功率`);
      if (power < 0) throw new UserError(`机台「${name}」的运行功率不能为负数`);
      const startMinute = parseClockMinutes(m.startTime, `机台「${name}」的开工时刻`, false);
      machine.power = power;
      machine.startMinute = startMinute;
    }
    machines.push(machine);
  });
  return machines;
}

const DAY_SECONDS = 24 * 60 * 60;

/**
 * 解析 HH:mm 时刻：允许省略小时前导 0（如 "6:05"）；
 * allowEnd24=true 时允许结束时刻填写 24:00（表示一日之末，返回 1440）；
 * 开工时刻只接受 00:00～23:59。返回自当日 00:00 起的分钟数。
 */
function parseClockMinutes(value, field, allowEnd24) {
  if (typeof value !== 'string') {
    throw new UserError(`${field}格式不正确，应为 HH:mm`);
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) {
    throw new UserError(`${field}格式不正确，应为 HH:mm（如 08:30）`);
  }
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (mm > 59 || hh > 24 || (hh === 24 && !(allowEnd24 && mm === 0))) {
    throw new UserError(
      allowEnd24
        ? `${field}必须是 00:00～24:00 之间的合法时刻（24:00 仅可作为结束时刻）`
        : `${field}必须是 00:00～23:59 之间的合法时刻`
    );
  }
  return hh * 60 + mm;
}

/**
 * 解析一天内的分时电价时段 tariffs：[{ start: 'HH:mm', end: 'HH:mm', price }]
 *  - 至少 1 段、最多 48 段；起止均为 HH:mm（结束允许 24:00），每段 start < end；
 *  - price（元 / 千瓦时）必须为非负数字；
 *  - 各时段按开始时刻排序后必须首尾相接：第一段从 00:00 开始、最后一段到 24:00 结束，
 *    既不重叠也不留空，完整覆盖一整天。
 * 返回按开始时刻升序排列的 [{ startMinute, endMinute, start, end, price }]。
 */
function parseTariffs(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new UserError('分时电费核算需要至少 1 个电价时段');
  }
  if (value.length > 48) {
    throw new UserError('电价时段数量过多（一天最多 48 段）');
  }
  const periods = value.map((t, i) => {
    if (!t || typeof t !== 'object') {
      throw new UserError(`第 ${i + 1} 个电价时段格式不正确`);
    }
    const startMinute = parseClockMinutes(t.start, `第 ${i + 1} 个电价时段的开始时刻`, false);
    const endMinute = parseClockMinutes(t.end, `第 ${i + 1} 个电价时段的结束时刻`, true);
    if (endMinute <= startMinute) {
      throw new UserError(`第 ${i + 1} 个电价时段结束时刻必须晚于开始时刻（同日时刻，不含跨午夜段）`);
    }
    const price = num(t.price, `第 ${i + 1} 个电价时段的电价`);
    if (price < 0) throw new UserError(`第 ${i + 1} 个电价时段的电价不能为负数`);
    return { startMinute, endMinute, price, inputIndex: i };
  });
  periods.sort((a, b) => a.startMinute - b.startMinute || b.inputIndex - a.inputIndex);
  if (periods[0].startMinute !== 0) {
    throw new UserError('电价时段必须从 00:00 开始完整覆盖一整天');
  }
  if (periods[periods.length - 1].endMinute !== 1440) {
    throw new UserError('电价时段必须完整覆盖到 24:00，不能提前结束');
  }
  for (let i = 0; i < periods.length; i++) {
    if (i > 0 && periods[i].startMinute !== periods[i - 1].endMinute) {
      const cur = minuteToClock(periods[i].startMinute);
      const prevEnd = minuteToClock(periods[i - 1].endMinute);
      if (periods[i].startMinute < periods[i - 1].endMinute) {
        throw new UserError(`电价时段在 ${cur} 附近重叠：各时段不得相互重叠`);
      }
      throw new UserError(`电价时段在 ${prevEnd}～${cur} 之间存在空档：必须无重叠且完整覆盖 00:00～24:00`);
    }
  }
  return periods.map((p) => ({
    start: minuteToClock(p.startMinute),
    end: minuteToClock(p.endMinute),
    startMinute: p.startMinute,
    endMinute: p.endMinute,
    price: p.price,
  }));
}

/** 分钟数（0～1440）格式化为 HH:mm；1440 格式化为 24:00。 */
function minuteToClock(minute) {
  const hh = Math.floor(minute / 60);
  const mm = minute % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * 一种切法（竖切优先 / 横切优先）中各刀的实际刀长：
 * 竖切刀长 = 锯缝带高度（贯穿区域全高），横切刀长 = 锯缝带宽度（贯穿区域全宽）。
 */
function cutLengths(split) {
  return split.cuts.map((c) => (c.type === 'v' ? c.band.h : c.band.w));
}

/**
 * 切法是否在设备能力内：所有刀的实际刀长均不超过最大单刀长度；
 * 未设置上限（null）时恒可行。
 */
function splitAllowed(split, maxCutLength) {
  if (maxCutLength === null) return true;
  return cutLengths(split).every((len) => len <= maxCutLength + EPS);
}

/**
 * 计算一次左上角落料后产生的刀路与两个余料矩形。
 * 区域 fr 左上角 (x,y)，宽 frW、高 frH；零件占位 w×h；锯缝 k。
 * verticalFirst=true 时先竖切，否则先横切。
 */
function buildSplit(fr, w, h, k, verticalFirst) {
  const { x, y, w: frW, h: frH } = fr;
  const rw = Math.max(0, frW - w);
  const rh = Math.max(0, frH - h);
  const cuts = [];
  const rects = [];

  if (verticalFirst) {
    // A：竖切，贯穿区域全高；右侧有余量才需要分离（锯缝为 0 时缝带宽度为 0，刀仍记录）
    const hasV = rw > EPS;
    const bA = hasV ? Math.min(k, rw) : 0;
    if (hasV) {
      cuts.push({
        type: 'v',
        band: { x: x + w, y, w: bA, h: frH },
      });
    }
    // B：在左侧（宽度恰好为 w 的）料块上横切；若没有竖切，则横切贯穿整板宽
    const spanW = hasV ? w : frW;
    const hasH = rh > EPS;
    const bB = hasH ? Math.min(k, rh) : 0;
    if (hasH) {
      cuts.push({
        type: 'h',
        band: { x, y: y + h, w: spanW, h: bB },
      });
    }
    // 右余料（竖切右侧，全高）
    if (rw - bA > EPS && frH > EPS) {
      rects.push({ x: x + w + bA, y, w: rw - bA, h: frH });
    }
    // 下余料（横切下方）
    if (rh - bB > EPS && spanW > EPS) {
      rects.push({ x, y: y + h + bB, w: spanW, h: rh - bB });
    }
  } else {
    // A：横切，贯穿区域全宽；下方有余量才需要分离
    const hasH = rh > EPS;
    const bA = hasH ? Math.min(k, rh) : 0;
    if (hasH) {
      cuts.push({
        type: 'h',
        band: { x, y: y + h, w: frW, h: bA },
      });
    }
    // B：在上侧（高度恰好为 h 的）料块上竖切；若没有横切，则竖切贯穿整板高
    const spanH = hasH ? h : frH;
    const hasV = rw > EPS;
    const bB = hasV ? Math.min(k, rw) : 0;
    if (hasV) {
      cuts.push({
        type: 'v',
        band: { x: x + w, y, w: bB, h: spanH },
      });
    }
    // 下余料（横切下方，全宽）
    if (rh - bA > EPS && frW > EPS) {
      rects.push({ x, y: y + h + bA, w: frW, h: rh - bA });
    }
    // 右余料（竖切右侧）
    if (rw - bB > EPS && spanH > EPS) {
      rects.push({ x: x + w + bB, y, w: rw - bB, h: spanH });
    }
  }

  const freeArea = rects.reduce((s, rect) => s + rect.w * rect.h, 0);
  return { cuts, rects, freeArea };
}

/**
 * 创建一张空白板材。
 *  - kind='standard'：按单板材料价 priceCents 计费的标准新板；
 *  - kind='stock'：临时余板库存（带唯一编号 stockId），不计材料价。
 */
function makeBoard(width, height, kind = 'standard', stockId = null, priceCents = 0) {
  return {
    width,
    height,
    kind,
    stockId,
    priceCents: kind === 'standard' ? priceCents : 0,
    free: [{ x: 0, y: 0, w: width, h: height }],
    placements: [],
    cuts: [],
    partsArea: 0,
    kerfArea: 0,
    orderAreas: new Map(), // 订单号 -> 该板上该订单零件实际面积
  };
}

/**
 * 单张板的材料费分摊（最大余数法）。
 *  - priceCents：该板板价（整数分）
 *  - entries：[{ order, area, seq }]，seq 为订单输入顺序（从 0 起）
 * 返回 [{ order, area, ratio, cents }]（仅含有零件的订单，按订单输入顺序），
 * cents 之和严格等于 priceCents；余数相同时按 seq 升序补尾差。
 */
function apportionBoardCost(priceCents, entries) {
  const rows = entries
    .filter((e) => e.area > EPS)
    .sort((a, b) => a.seq - b.seq);
  const totalArea = rows.reduce((s, e) => s + e.area, 0);

  if (priceCents === 0 || rows.length === 0 || totalArea <= EPS) {
    return rows.map((e) => ({
      order: e.order,
      area: e.area,
      ratio: 0,
      cents: 0,
    }));
  }

  const exactNum = rows.map((e) => priceCents * e.area); // 精确份额 = num / totalArea
  // floor 拆分：用小容差吸收浮点误差，保证份额之和守恒
  const FEPS = 1e-9 * Math.max(1, priceCents);
  const floorVals = exactNum.map((num) => {
    const v = num / totalArea;
    const f = Math.floor(v);
    const rem = Math.max(0, v - f);
    if (rem > 1 - FEPS) return { base: f + 1, remNum: 0 };
    // 份额接近整数时余数归零（浮点误差），否则保留精确余数分子
    const remNum = rem < FEPS ? 0 : num - f * totalArea;
    return { base: Math.max(0, f), remNum: remNum < 1e-6 ? 0 : remNum };
  });
  const base = floorVals.map((x) => x.base);
  let left = priceCents - base.reduce((s, v) => s + v, 0);

  // 余数 = remNum / totalArea（分母相同，直接比较分子即可，避免除法浮点误差）。
  // 余数相同（含同余）时按订单输入顺序补尾差。
  const ranked = floorVals
    .map((x, i) => ({ i, remNum: x.remNum, seq: rows[i].seq }))
    .sort((a, b) => {
      // 余数大的排前面；remNum 与面积同量纲（mm²·分），绝对误差远小于 1 时视为同余
      if (a.remNum - b.remNum > 1e-6) return -1;
      if (b.remNum - a.remNum > 1e-6) return 1;
      return a.seq - b.seq;
    });

  const cents = base.slice();
  let k = 0;
  while (left > 0) {
    cents[ranked[k % ranked.length].i] += 1;
    left -= 1;
    k += 1;
  }

  return rows.map((e, i) => ({
    order: e.order,
    area: e.area,
    ratio: Math.round((e.area / totalArea) * 10000) / 100, // 百分比，保留两位
    cents: cents[i],
  }));
}

/**
 * 解析并校验排料输入（多订单 / 旧版单订单），返回归一化参数与展平的零件行。
 * groups：[{ order, seq(订单顺序), name, width, height, quantity }]，按输入顺序排列；
 * ordersList：[{ order, seq }]，按订单输入顺序去重。
 */
function parseInput(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }

  const boardWidth = num(input.boardWidth, '原板长度');
  const boardHeight = num(input.boardHeight, '原板宽度');
  const kerf = input.kerf === undefined || input.kerf === null || input.kerf === ''
    ? 0
    : num(input.kerf, '锯缝宽度');
  const boardPriceCents = priceToCents(input.boardPrice);
  const maxCutLength = parseMaxCutLength(input.maxCutLength);
  const minOffcutLength = parseMinOffcut(input.minOffcutLength, '余料回收最小长度');
  const minOffcutWidth = parseMinOffcut(input.minOffcutWidth, '余料回收最小宽度');
  const stockBoards = parseStockBoards(input.stockBoards);

  if (boardWidth <= 0) throw new UserError('原板长度必须大于 0');
  if (boardHeight <= 0) throw new UserError('原板宽度必须大于 0');
  if (kerf < 0) throw new UserError('锯缝宽度不能为负数');

  // 归一化订单：旧版顶层 parts → 单个订单
  let rawOrders;
  if (Array.isArray(input.orders)) {
    rawOrders = input.orders;
  } else if (Array.isArray(input.parts)) {
    rawOrders = [{ orderNo: '', parts: input.parts }];
  } else {
    rawOrders = [];
  }
  if (rawOrders.length === 0) {
    throw new UserError('请至少添加一个订单');
  }
  if (rawOrders.length > 200) {
    throw new UserError('订单数量过多（最多 200 个）');
  }

  // 展平后的排料序列：[{ order, seq(订单顺序), name, width, height, quantity }]
  const groups = [];
  const ordersList = [];
  const usedOrderNos = new Set();
  let totalRows = 0;
  let totalQty = 0;

  rawOrders.forEach((o, oi) => {
    if (!o || typeof o !== 'object') {
      throw new UserError(`第 ${oi + 1} 个订单格式不正确`);
    }
    const orderNo = (o.orderNo === undefined || o.orderNo === null || String(o.orderNo).trim() === '')
      ? `订单${oi + 1}`
      : String(o.orderNo).trim();
    if (usedOrderNos.has(orderNo)) {
      throw new UserError(`订单号重复：${orderNo}`);
    }
    usedOrderNos.add(orderNo);
    ordersList.push({ order: orderNo, seq: oi });

    const rawParts = Array.isArray(o.parts) ? o.parts : [];
    if (rawParts.length === 0) {
      throw new UserError(`订单「${orderNo}」至少需要一种零件`);
    }

    const usedNames = new Set();
    rawParts.forEach((p, pi) => {
      if (!p || typeof p !== 'object') {
        throw new UserError(`订单「${orderNo}」第 ${pi + 1} 行零件格式不正确`);
      }
      const name = (p.name === undefined || p.name === null || String(p.name).trim() === '')
        ? `零件${pi + 1}`
        : String(p.name).trim();
      if (usedNames.has(name)) {
        throw new UserError(`订单「${orderNo}」内零件名称重复：${name}（不同订单允许同名）`);
      }
      usedNames.add(name);

      const w = num(p.width, `订单「${orderNo}」零件「${name}」的长度`);
      const h = num(p.height, `订单「${orderNo}」零件「${name}」的宽度`);
      const q = positiveInt(p.quantity, `订单「${orderNo}」零件「${name}」的数量`);
      if (w <= 0) throw new UserError(`订单「${orderNo}」零件「${name}」的长度必须大于 0`);
      if (h <= 0) throw new UserError(`订单「${orderNo}」零件「${name}」的宽度必须大于 0`);

      // 旋转后仍无法放入标准原板时，再检查是否至少能放入某块余板库存
      const fitsBoard = (bw, bh) =>
        (w <= bw + EPS && h <= bh + EPS) || (h <= bw + EPS && w <= bh + EPS);
      if (!fitsBoard(boardWidth, boardHeight) &&
          !stockBoards.some((s) => fitsBoard(s.width, s.height))) {
        throw new UserError(
          `订单「${orderNo}」零件「${name}」尺寸 ${w} × ${h} 旋转后仍无法放入原板 ${boardWidth} × ${boardHeight}，也放不进任何余板`
        );
      }

      totalRows += 1;
      if (totalRows > 500) {
        throw new UserError('零件行数过多（所有订单合计最多 500 行）');
      }
      totalQty += q;
      if (totalQty > 10000) {
        throw new UserError('零件总数量过多（最多 10000 件）');
      }

      groups.push({ order: orderNo, seq: oi, name, width: w, height: h, quantity: q });
    });
  });

  return {
    boardWidth,
    boardHeight,
    kerf,
    boardPriceCents,
    maxCutLength,
    minOffcutLength,
    minOffcutWidth,
    stockBoards,
    groups,
    ordersList,
    totalQty,
    legacy: !Array.isArray(input.orders),
  };
}

/**
 * 核心排料：按 groups 顺序（订单 → 零件行 → 数量）逐件断头切割落料。
 * 每个 group 可带 tag = { index, srcBoard }（缺件补切场景）：
 * 落位件号取 tag.index（原件号），并在落位上记录 srcBoard（原板号）。
 *
 * stockBoards：临时余板库存 [{ id, width, height }]（按输入顺序）。
 * 零件在所有已开板（含先前已启用的余板）的可用矩形中均无可行落位时：
 * 先按输入顺序取第一块“尚未使用且存在可行切法（含旋转、单刀上限）”的余板开启；
 * 仍无可用余板时才开启标准新板。每块余板最多使用一次。
 * stockBoards 为空 / 缺省即完全沿用原规则（补切独立排料时不传库存）。
 *
 * maxCutLength：设备最大单刀长度（null 表示不限制）。对每个候选落位（已开板的
 * 可用矩形 / 未用余板 / 新板）与每个朝向，分别构造竖切优先、横切优先两种切法并计算各自的
 * 实际刀长；仅当一种切法中所有刀长均不超过上限时，该切法才可行。
 * 同一落位 + 朝向下竖切优先、横切优先之间，沿用“锯缝损耗更小（余料面积更大）”
 * 的现有规则选取（平局取竖切）；落位 / 朝向之间沿用现有评分规则。
 *
 * 返回 { boards, usedStockIndices }。
 */
function layoutParts(boardWidth, boardHeight, kerf, groups, maxCutLength, stockBoards, boardPriceCents) {
  const boards = [];
  const stocks = stockBoards || [];
  const usedStocks = new Set(); // 已启用余板在 stocks 中的下标（每块最多使用一次）

  // 枚举某零件在指定可用矩形 + 朝向下的可行切法（按现有规则：余料面积大的优先，平局取竖切）
  const feasibleSplit = (fr, ori) => {
    const w = Math.min(ori.w, fr.w);
    const h = Math.min(ori.h, fr.h);
    const vSplit = buildSplit(fr, w, h, kerf, true);
    const hSplit = buildSplit(fr, w, h, kerf, false);
    const vOk = splitAllowed(vSplit, maxCutLength);
    const hOk = splitAllowed(hSplit, maxCutLength);
    if (!vOk && !hOk) return null;
    if (vOk && !hOk) return vSplit;
    if (hOk && !vOk) return hSplit;
    // 两种切法刀长均不超限：锯缝损失更小（余料面积更大）的优先，平局取竖切
    return hSplit.freeArea > vSplit.freeArea + EPS ? hSplit : vSplit;
  };

  // 现有板均无可行落位时先尝试未用余板、最后在标准新板上尝试；
  // 新板也无法加工时给出订单 / 零件 / 件号
  const failPart = (part, index) => {
    if (maxCutLength === null) {
      throw new UserError(
        `订单「${part.order}」零件「${part.name}」尺寸 ${part.width} × ${part.height} 无法放入原板 ${boardWidth} × ${boardHeight}`
      );
    }
    // 给出几何上能放入整板的朝向中，两种切法各自所需的最小刀长上确界，便于现场判断
    const needsOnBoard = (bw, bh) => {
      const fr = { x: 0, y: 0, w: bw, h: bh };
      const oris = [{ w: part.width, h: part.height, rotated: false, label: '不旋转' }];
      if (Math.abs(part.width - part.height) > EPS) {
        oris.push({ w: part.height, h: part.width, rotated: true, label: '旋转' });
      }
      const needs = [];
      for (const ori of oris) {
        if (ori.w > fr.w + EPS || ori.h > fr.h + EPS) continue;
        const w = Math.min(ori.w, fr.w);
        const h = Math.min(ori.h, fr.h);
        const maxLen = (verticalFirst) => {
          const s = buildSplit(fr, w, h, kerf, verticalFirst);
          return s.cuts.length ? Math.max(...cutLengths(s)) : 0;
        };
        needs.push(`${ori.label}朝向下竖切优先需单刀 ${round3(maxLen(true))}、横切优先需单刀 ${round3(maxLen(false))}`);
      }
      return needs;
    };
    const needs = needsOnBoard(boardWidth, boardHeight);
    // 尚未使用且几何上能容纳该件的余板，同样附所需刀长，便于判断是否可手工放行
    const stockNeeds = [];
    stocks.forEach((s, si) => {
      if (usedStocks.has(si)) return;
      const n = needsOnBoard(s.width, s.height);
      if (n.length) stockNeeds.push(`余板「${s.id}」（${s.width} × ${s.height}）：${n.join('；')}`);
    });
    throw new UserError(
      `订单「${part.order}」零件「${part.name}」第 ${index} 件无法在最大单刀长度 ${maxCutLength} 内加工` +
      (needs.length ? `（标准原板 ${boardWidth} × ${boardHeight}：${needs.join('；')}）` : '（零件旋转后仍大于标准原板）') +
      (stockNeeds.length ? `；未用余板情况——${stockNeeds.join('；')}` : '')
    );
  };

  for (const part of groups) {
    for (let q = 1; q <= part.quantity; q++) {
      const index = part.tag ? part.tag.index : q;
      const orientations = [{ w: part.width, h: part.height, rotated: false }];
      if (Math.abs(part.width - part.height) > EPS) {
        orientations.push({ w: part.height, h: part.width, rotated: true });
      }

      let best = null; // { boardIndex, freeIndex, ori, split, fr, score }

      const betterScore = (a, b) => {
        for (let idx = 0; idx < a.length; idx++) {
          if (a[idx] < b[idx] - EPS) return true;
          if (a[idx] > b[idx] + EPS) return false;
        }
        return false; // 完全相同，保留先出现的候选
      };

      for (let bi = 0; bi < boards.length; bi++) {
        const board = boards[bi];
        for (let fi = 0; fi < board.free.length; fi++) {
          const fr = board.free[fi];
          for (const ori of orientations) {
            if (ori.w > fr.w + EPS || ori.h > fr.h + EPS) continue;
            const split = feasibleSplit(fr, ori);
            if (!split) continue; // 该落位 / 朝向下两种切法均超单刀上限

            // 评分：最紧凑的可用区域 → 余料损失最小 → 靠上 → 靠左 → 已开板 → 不旋转
            const score = [
              fr.w * fr.h,
              -split.freeArea,
              fr.y,
              fr.x,
              bi,
              ori.rotated ? 1 : 0,
            ];
            if (!best || betterScore(score, best.score)) {
              best = { boardIndex: bi, freeIndex: fi, ori, split, fr, score };
            }
          }
        }
      }

      // 现有板材（含已启用余板）均无可行落位（放不下或刀长超限）：
      // 先按输入顺序尝试尚未使用、且能加工该件的余板，仍不可行才开标准新板
      if (!best) {
        // 在一张空白板上找首个可行落位：朝向按“不旋转优先”枚举（正方形仅一个朝向）
        const tryFreshBoard = (board) => {
          const fr = board.free[0];
          for (const ori of orientations) {
            if (ori.w > fr.w + EPS || ori.h > fr.h + EPS) continue;
            const split = feasibleSplit(fr, ori);
            if (split) return { board, ori, split, fr };
          }
          return null;
        };

        let opened = null;
        for (let si = 0; si < stocks.length; si++) {
          if (usedStocks.has(si)) continue; // 每块余板最多使用一次
          const s = stocks[si];
          const candidate = tryFreshBoard(makeBoard(s.width, s.height, 'stock', s.id));
          if (candidate) {
            usedStocks.add(si);
            opened = candidate;
            break; // 依输入顺序取第一块可行余板
          }
        }
        if (!opened) {
          const stdBoard = makeBoard(boardWidth, boardHeight, 'standard', null, boardPriceCents);
          opened = tryFreshBoard(stdBoard);
          if (!opened) {
            failPart(part, index);
          }
        }
        boards.push(opened.board);
        best = {
          boardIndex: boards.length - 1,
          freeIndex: 0,
          ori: opened.ori,
          split: opened.split,
          fr: opened.fr,
        };
      }

      const board = boards[best.boardIndex];
      const fr = best.fr;
      const { ori, split } = best;
      const w = Math.min(ori.w, fr.w);
      const h = Math.min(ori.h, fr.h);
      const area = w * h;

      board.placements.push({
        order: part.order,
        part: part.name,
        index,
        x: fr.x,
        y: fr.y,
        w,
        h,
        rotated: ori.rotated,
        ...(part.tag && part.tag.srcBoard !== undefined ? { srcBoard: part.tag.srcBoard } : {}),
      });
      board.partsArea += area;
      board.orderAreas.set(part.order, (board.orderAreas.get(part.order) || 0) + area);
      for (const c of split.cuts) {
        board.cuts.push(c);
        board.kerfArea += c.band.w * c.band.h;
      }
      board.free.splice(best.freeIndex, 1, ...split.rects);
    }
  }

  return { boards, usedStockIndices: usedStocks };
}

// 输出统一保留 3 位小数，0 归一
const round3 = (v) => Math.abs(v) < EPS ? 0 : Math.round(v * 1000) / 1000;

/**
 * 可回收余料清单：从每张板最终的空闲矩形提取实际可取走的余料。
 *  - 空闲矩形已扣除零件占位与锯缝带，彼此互不重叠，面积之和即该板余料面积；
 *  - minLength / minWidth 为可配置的最小回收尺寸（0 = 不筛选）：余料按当前朝向
 *    或旋转 90° 后满足 长 ≥ minLength 且 宽 ≥ minWidth 即视为可回收；
 *  - 编号为 B{来源板号}-R{区域序号}，区域序号为该板最终空闲区域的顺序号（从 1 起），
 *    未通过筛选的区域保留序号但不进入清单，同一区域在不同筛选条件下编号稳定。
 * 返回 { offcuts, offcutArea }（offcutArea 为未舍入的清单总面积）。
 */
function collectOffcuts(boards, minLength, minWidth) {
  const offcuts = [];
  let offcutArea = 0;
  boards.forEach((b, bi) => {
    let region = 0;
    for (const fr of b.free) {
      if (fr.w <= EPS || fr.h <= EPS) continue;
      region += 1;
      const fits =
        (fr.w >= minLength - EPS && fr.h >= minWidth - EPS) ||
        (fr.h >= minLength - EPS && fr.w >= minWidth - EPS);
      if (!fits) continue;
      offcutArea += fr.w * fr.h;
      offcuts.push({
        id: `B${bi + 1}-R${region}`,
        board: bi + 1,
        region,
        x: round3(fr.x),
        y: round3(fr.y),
        w: round3(fr.w),
        h: round3(fr.h),
        area: round3(fr.w * fr.h),
      });
    }
  });
  return { offcuts, offcutArea };
}

/**
 * 刀路执行前置关系回放（只读计算，不影响落位 / 分摊 / 排程）。
 * 以未舍入几何按现有刀序回放矩形切分：
 *  - 初始为整板矩形（无产生刀）；每刀的锯缝带严格位于某个当前矩形内部
 *    （法向坐标落在矩形内部，全部当前矩形中唯一被包含）；
 *  - 该刀的直接前置 = 所切矩形的产生刀；初始整板无前置（返回 -1）；
 *  - 回放时从所切矩形中扣除该刀的实际锯缝带（边修刀缝带可能窄于标准锯缝、
 *    零锯缝时缝带宽度为 0），剩余矩形记为由该刀产生，供后续刀查找所属。
 * cuts：未舍入的刀路数组（{ type, band }，按刀序排列）。
 * 返回与 cuts 等长的数组，元素为直接前置刀在 cuts 中的下标（-1 表示无前置）。
 */
function traceCutPredecessors(boardWidth, boardHeight, cuts) {
  // 当前矩形集合：{ x, y, w, h, by }，by = 产生该矩形的刀下标（-1 = 初始整板）
  const rects = [{ x: 0, y: 0, w: boardWidth, h: boardHeight, by: -1 }];
  const pushRect = (rect) => {
    if (rect.w > EPS && rect.h > EPS) rects.push(rect);
  };
  return cuts.map((c, ci) => {
    const band = c.band;
    const ri = rects.findIndex((r) =>
      band.x >= r.x - EPS && band.y >= r.y - EPS &&
      band.x + band.w <= r.x + r.w + EPS && band.y + band.h <= r.y + r.h + EPS
    );
    if (ri === -1) return -1; // 几何上不会发生（刀路与回放同源），兜底按无前置处理
    const r = rects[ri];
    rects.splice(ri, 1);
    if (c.type === 'v') {
      // 竖切：扣除实际锯缝带后分为左块与右块
      pushRect({ x: r.x, y: r.y, w: band.x - r.x, h: r.h, by: ci });
      pushRect({ x: band.x + band.w, y: r.y, w: r.x + r.w - band.x - band.w, h: r.h, by: ci });
    } else {
      // 横切：扣除实际锯缝带后分为上块与下块
      pushRect({ x: r.x, y: r.y, w: r.w, h: band.y - r.y, by: ci });
      pushRect({ x: r.x, y: band.y + band.h, w: r.w, h: r.y + r.h - band.y - band.h, by: ci });
    }
    return r.by;
  });
}

/**
 * 输出整理：逐板编号、刀路端点、面积统计与逐板材料费分摊（最大余数法），
 * 同时按订单汇总件数 / 面积 / 分摊额 / 所在板号。
 * ordersList：[{ order, seq }]，决定汇总与分摊的订单顺序。
 */
function summarizeBoards(boards, ordersList) {
  const orderSeq = new Map(ordersList.map((o) => [o.order, o.seq]));
  const orderSummary = new Map();
  ordersList.forEach((o) => {
    orderSummary.set(o.order, {
      order: o.order,
      partsArea: 0,
      partsCount: 0,
      materialCents: 0,
      boardIndices: new Set(),
    });
  });

  const resultBoards = boards.map((b, bi) => {
    // 刀路执行前置：按现有刀序回放矩形切分，得到每刀的直接前置（0 = 初始整板、无前置）
    const preds = traceCutPredecessors(b.width, b.height, b.cuts);
    const cuts = b.cuts.map((c, i) => {
      const seq = i + 1;
      const pred = preds[i] < 0 ? 0 : preds[i] + 1;
      const { band } = c;
      const base = { seq, pred, type: c.type, band: { x: round3(band.x), y: round3(band.y), w: round3(band.w), h: round3(band.h) } };
      if (c.type === 'v') {
        const cx = band.x + band.w / 2;
        return { ...base, x1: round3(cx), y1: round3(band.y), x2: round3(cx), y2: round3(band.y + band.h), length: round3(band.h) };
      }
      const cy = band.y + band.h / 2;
      return { ...base, x1: round3(band.x), y1: round3(cy), x2: round3(band.x + band.w), y2: round3(cy), length: round3(band.w) };
    });

    const boardArea = b.width * b.height;
    const remainderArea = boardArea - b.partsArea - b.kerfArea;

    // 逐板按订单面积比例分摊板价（最大余数法，同余按订单输入顺序）；
    // 余板库存板价为 0，各订单分摊额均为 0（材料费只对标准新板收取）
    const shareRows = apportionBoardCost(
      b.priceCents,
      [...b.orderAreas.entries()].map(([order, area]) => ({
        order,
        area,
        seq: orderSeq.get(order),
      }))
    );
    const shares = shareRows.map((s) => {
      const summary = orderSummary.get(s.order);
      summary.materialCents += s.cents;
      summary.partsArea += s.area; // 使用未舍入面积，最后统一 round
      summary.boardIndices.add(bi + 1);
      return {
        order: s.order,
        area: round3(s.area),
        ratio: s.ratio,
        cents: s.cents,
      };
    });

    for (const p of b.placements) {
      orderSummary.get(p.order).partsCount += 1;
    }

    return {
      index: bi + 1,
      kind: b.kind,
      ...(b.stockId !== null ? { stockId: b.stockId } : {}),
      width: round3(b.width),
      height: round3(b.height),
      longestCut: cuts.length ? round3(Math.max(...cuts.map((c) => c.length))) : 0,
      placements: b.placements.map((p) => ({
        order: p.order,
        part: p.part,
        index: p.index,
        x: round3(p.x),
        y: round3(p.y),
        w: round3(p.w),
        h: round3(p.h),
        rotated: p.rotated,
        ...(p.srcBoard !== undefined ? { srcBoard: p.srcBoard } : {}),
      })),
      cuts,
      partsArea: round3(b.partsArea),
      kerfArea: round3(b.kerfArea),
      remainderArea: round3(remainderArea),
      utilization: Math.round((b.partsArea / boardArea) * 1000) / 10,
      cost: {
        priceCents: b.priceCents,
        shares,
      },
    };
  });

  return { resultBoards, orderSummary };
}

/**
 * 订单汇总行（按订单输入顺序）：件数、面积、分摊额（分）、所在板号（升序去重）。
 */
function orderSummaryRows(orderSummary) {
  return [...orderSummary.values()].map((s) => ({
    order: s.order,
    partsCount: s.partsCount,
    partsArea: round3(s.partsArea),
    materialCents: s.materialCents,
    boardIndices: [...s.boardIndices].sort((a, b) => a - b),
  }));
}

/**
 * 多订单拼版主入口。
 * 多订单输入：
 *   {
 *     boardWidth, boardHeight, kerf, boardPrice,
 *     orders: [{ orderNo, parts: [{ name, width, height, quantity }] }]
 *   }
 * 兼容旧版单订单输入（顶层 parts，无 orders）：整体视为一个订单。
 * 返回逐板裁切方案与按订单的取件清单 / 材料费分摊；输入不合法时抛 UserError。
 */
function cutBoards(input) {
  const parsed = parseInput(input);
  const { boardWidth, boardHeight, kerf, boardPriceCents, maxCutLength, stockBoards } = parsed;
  const { minOffcutLength, minOffcutWidth } = parsed;

  const { boards, usedStockIndices } = layoutParts(
    boardWidth, boardHeight, kerf, parsed.groups, maxCutLength, stockBoards, boardPriceCents
  );
  const { resultBoards, orderSummary } = summarizeBoards(boards, parsed.ordersList);

  // 可回收余料清单：只读提取各板最终空闲矩形，不影响落位与分摊
  const { offcuts, offcutArea } = collectOffcuts(boards, minOffcutLength, minOffcutWidth);

  // 分单取件清单：按订单输入顺序，件内按零件行 / 件号（即切割输入顺序）
  const pickList = [...orderSummary.values()].map((summary) => {
    const items = [];
    for (const b of resultBoards) {
      for (const p of b.placements) {
        if (p.order === summary.order) {
          items.push({
            part: p.part,
            index: p.index,
            board: b.index,
            x: p.x,
            y: p.y,
            w: p.w,
            h: p.h,
            rotated: p.rotated,
          });
        }
      }
    }
    // boards 已按板号升序遍历；同板内 placements 即落料（输入）顺序
    return { order: summary.order, items };
  });

  const orders = orderSummaryRows(orderSummary);

  // 总面积 / 余料按各板实际尺寸求和（余板尺寸可能与标准板不同）
  const totalArea = boards.reduce((s, b) => s + b.width * b.height, 0);
  const partsArea = resultBoards.reduce((s, b) => s + b.partsArea, 0);
  const kerfArea = resultBoards.reduce((s, b) => s + b.kerfArea, 0);
  const remainderArea = totalArea - partsArea - kerfArea;

  // 材料费只对新增标准板收取：余板库存板价为 0，不参与计费
  const standardBoardsCount = boards.filter((b) => b.kind === 'standard').length;
  const totalMaterialCents = standardBoardsCount * boardPriceCents;

  // 余板库存耗用结果：已用（按实际开料顺序）/ 未用（按输入顺序）
  const boardIndexByStockId = new Map();
  resultBoards.forEach((b) => {
    if (b.kind === 'stock') boardIndexByStockId.set(b.stockId, b.index);
  });
  const stockUsed = stockBoards
    .map((s, i) => ({ s, i, board: boardIndexByStockId.get(s.id) }))
    .filter((x) => x.board !== undefined)
    .sort((a, b) => a.board - b.board)
    .map((x) => ({
      id: x.s.id,
      inputIndex: x.i + 1,
      board: x.board,
      width: round3(x.s.width),
      height: round3(x.s.height),
    }));
  const stockUnused = stockBoards
    .map((s, i) => ({ s, i }))
    .filter((x) => !boardIndexByStockId.has(x.s.id))
    .map((x) => ({
      inputIndex: x.i + 1,
      id: x.s.id,
      width: round3(x.s.width),
      height: round3(x.s.height),
    }));

  return {
    mode: parsed.legacy ? 'single' : 'orders',
    boardWidth: round3(boardWidth),
    boardHeight: round3(boardHeight),
    kerf: round3(kerf),
    boardPrice: round3(boardPriceCents / 100),
    maxCutLength: maxCutLength === null ? null : round3(maxCutLength),
    minOffcutLength: round3(minOffcutLength),
    minOffcutWidth: round3(minOffcutWidth),
    offcuts,
    offcutArea: round3(offcutArea),
    stockBoards: stockBoards.map((s) => ({
      id: s.id,
      width: round3(s.width),
      height: round3(s.height),
    })),
    stockUsed,
    stockUnused,
    boardsCount: boards.length,
    standardBoardsCount,
    totalParts: parsed.totalQty,
    totalArea: round3(totalArea),
    partsArea: round3(partsArea),
    kerfArea: round3(kerfArea),
    remainderArea: round3(remainderArea),
    utilization: Math.round((partsArea / totalArea) * 1000) / 10,
    totalMaterialCents,
    orders,
    pickList,
    boards: resultBoards,
  };
}

/**
 * 缺件补切。
 * 输入 = 排料输入（同 cutBoards）+ damaged: [{ order, part, index }]，
 * 以“订单号 + 零件名 + 件号”三元身份标识损坏件（跨订单同名零件互不影响）。
 *
 * 流程：以当前排料输入重新计算原方案 → 校验所选件存在且无重复 →
 * 仅将所选件按原始尺寸与原输入顺序（订单 → 零件行 → 件号）合并，
 * 重排为独立的补切方案；原方案落位与材料费分摊保持不变。
 *
 * 返回 { original, recut }：
 *  - original：与 cutBoards 完全相同的原方案输出；
 *  - recut.items：补切清单，逐件关联原板号（srcBoard）与新板号（board）；
 *  - recut.addedBoards / addedMaterialCents：新增板数与新增材料费（分）；
 *  - recut.boards：补切新板的落位、刀序与逐板分摊。
 */
function recutBoards(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }
  const parsed = parseInput(input);
  const { boardWidth, boardHeight, kerf, boardPriceCents, maxCutLength } = parsed;

  // 以当前排料输入重新计算原方案（原样输出，落位与分摊不受补切影响）
  const original = cutBoards(input);

  // ---- 校验损坏件选择 ----
  const damaged = input.damaged;
  if (!Array.isArray(damaged) || damaged.length === 0) {
    throw new UserError('请至少选择一件需要补切的损坏件');
  }
  if (damaged.length > 1000) {
    throw new UserError('单次补切件数过多（最多 1000 件）');
  }

  // 零件行索引：订单号 + 零件名 → 原始尺寸 / 数量 / 输入顺序
  const lineMap = new Map();
  parsed.groups.forEach((g, pos) => {
    lineMap.set(JSON.stringify([g.order, g.name]), {
      width: g.width,
      height: g.height,
      quantity: g.quantity,
      pos,
      orderSeq: g.seq,
    });
  });

  // 原方案落位索引：订单号 + 零件名 + 件号 → 原板号
  const placedBoard = new Map();
  for (const b of original.boards) {
    for (const p of b.placements) {
      placedBoard.set(JSON.stringify([p.order, p.part, p.index]), b.index);
    }
  }

  const seen = new Set();
  const selected = [];
  damaged.forEach((d, i) => {
    if (!d || typeof d !== 'object') {
      throw new UserError(`第 ${i + 1} 条损坏件格式不正确`);
    }
    const order = d.order === undefined || d.order === null ? '' : String(d.order).trim();
    const part = d.part === undefined || d.part === null ? '' : String(d.part).trim();
    if (!order) throw new UserError(`第 ${i + 1} 条损坏件缺少订单号`);
    if (!part) throw new UserError(`第 ${i + 1} 条损坏件缺少零件名`);
    const index = Number(d.index);
    if (!Number.isInteger(index) || index < 1) {
      throw new UserError(`损坏件「${order} / ${part}」的件号必须是不小于 1 的整数`);
    }
    const key = JSON.stringify([order, part, index]);
    if (seen.has(key)) {
      throw new UserError(`损坏件重复选择：订单「${order}」零件「${part}」第 ${index} 件`);
    }
    seen.add(key);
    const line = lineMap.get(JSON.stringify([order, part]));
    const srcBoard = placedBoard.get(key);
    if (!line || index > line.quantity || srcBoard === undefined) {
      throw new UserError(`损坏件不存在：订单「${order}」零件「${part}」第 ${index} 件`);
    }
    selected.push({
      order,
      part,
      index,
      width: line.width,
      height: line.height,
      pos: line.pos,
      orderSeq: line.orderSeq,
      srcBoard,
    });
  });

  // 按原输入顺序（订单 → 零件行 → 件号）排序后合并重排
  selected.sort((a, b) => (a.pos - b.pos) || (a.index - b.index));

  // 每件独立成行（保留三元身份：订单归属、原件号、原板号），按原始尺寸排料
  const recutGroups = selected.map((s) => ({
    order: s.order,
    seq: s.orderSeq,
    name: s.part,
    width: s.width,
    height: s.height,
    quantity: 1,
    tag: { index: s.index, srcBoard: s.srcBoard },
  }));

  // 补切独立使用标准新板：不传余板库存，不重复耗用库存
  const { boards } = layoutParts(
    boardWidth, boardHeight, kerf, recutGroups, maxCutLength, [], boardPriceCents
  );

  // 补切订单汇总仅含涉及订单，顺序仍按原订单输入顺序
  const recutOrdersList = [];
  const seenOrders = new Set();
  for (const s of selected) {
    if (!seenOrders.has(s.order)) {
      seenOrders.add(s.order);
      recutOrdersList.push({ order: s.order, seq: s.orderSeq });
    }
  }
  const { resultBoards, orderSummary } = summarizeBoards(boards, recutOrdersList);

  // 补切清单：逐件关联原板号与新板号（新板号升序，同板按落料顺序）
  const items = [];
  for (const b of resultBoards) {
    for (const p of b.placements) {
      items.push({
        order: p.order,
        part: p.part,
        index: p.index,
        srcBoard: p.srcBoard,
        board: b.index,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        rotated: p.rotated,
      });
    }
  }

  const addedBoards = resultBoards.length;
  const addedMaterialCents = addedBoards * boardPriceCents;
  const totalArea = addedBoards * boardWidth * boardHeight;
  const partsArea = resultBoards.reduce((s, b) => s + b.partsArea, 0);
  const kerfArea = resultBoards.reduce((s, b) => s + b.kerfArea, 0);

  return {
    original,
    recut: {
      boardWidth: round3(boardWidth),
      boardHeight: round3(boardHeight),
      kerf: round3(kerf),
      boardPrice: round3(boardPriceCents / 100),
      maxCutLength: maxCutLength === null ? null : round3(maxCutLength),
      damagedCount: selected.length,
      addedBoards,
      addedMaterialCents,
      partsArea: round3(partsArea),
      kerfArea: round3(kerfArea),
      remainderArea: round3(totalArea - partsArea - kerfArea),
      utilization: addedBoards ? Math.round((partsArea / totalArea) * 1000) / 10 : 0,
      items,
      orders: orderSummaryRows(orderSummary),
      boards: resultBoards,
    },
  };
}

/**
 * 撤单影响预览。
 * 输入 = 排料输入（同 cutBoards，须为多订单 orders 模式）+ cancelOrder（要撤单的订单号）。
 *
 * 流程：以输入快照重算撤单前方案 → 校验撤单对象（至少两张订单、订单号有效）→
 * 从订单清单中筛除该订单后重算撤单后方案。订单号空白的订单先按原输入位置
 * 固定自动编号（订单1、订单2…），筛除后其余订单保持原名、不重新编号；
 * 撤单前后两套方案互不影响，原方案落位与分摊保持不变。
 *
 * 返回 { cancelOrder, cancelled, before, after, orders, diff }：
 *  - before / after：撤单前后汇总（新增标准板数、已用余板编号、材料费总额、各订单分摊额）；
 *  - cancelled：被撤订单及其撤单前分摊额（分）；
 *  - orders：每张保留订单的撤单前 / 后分摊额与增减差值（均为整数分，差值 = 后 − 前）；
 *  - diff：新增标准板数与材料费总额的差值（后 − 前）、已用余板编号增删。
 */
function cancelPreviewBoards(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }
  // 解析输入快照：订单号空白处在此按原输入位置固定自动编号
  const parsed = parseInput(input);

  const cancelOrder = input.cancelOrder === undefined || input.cancelOrder === null
    ? ''
    : String(input.cancelOrder).trim();
  if (!cancelOrder) {
    throw new UserError('请指定要撤单的订单号');
  }
  if (parsed.ordersList.length < 2) {
    throw new UserError('撤单预览至少需要两张订单，当前方案只有一张订单');
  }
  const target = parsed.ordersList.find((o) => o.order === cancelOrder);
  if (!target) {
    throw new UserError(
      `撤单订单号无效：「${cancelOrder}」不在当前方案中（可选：${parsed.ordersList.map((o) => o.order).join('、')}）`
    );
  }

  // 撤单前：以输入快照原样重算（与生成方案时一致）
  const before = cutBoards(input);

  // 撤单后：筛除目标订单；其余订单显式带上已固定的订单号，保证不改名、不重排
  const afterOrders = input.orders
    .map((o, oi) => ({ ...o, orderNo: parsed.ordersList[oi].order }))
    .filter((o) => o.orderNo !== cancelOrder);
  const after = cutBoards({ ...input, orders: afterOrders });

  // 汇总快照：新增标准板数、已用余板编号（按板号顺序）、材料费总额与各订单分摊额
  const summarize = (r) => ({
    boardsCount: r.boardsCount,
    standardBoardsCount: r.standardBoardsCount,
    stockUsed: r.stockUsed.map((s) => s.id),
    totalMaterialCents: r.totalMaterialCents,
    orders: r.orders.map((o) => ({ order: o.order, materialCents: o.materialCents })),
  });
  const beforeSum = summarize(before);
  const afterSum = summarize(after);

  // 保留订单对照（按原订单输入顺序）：差值按整数分计算（后 − 前）
  const beforeCents = new Map(beforeSum.orders.map((o) => [o.order, o.materialCents]));
  const orders = afterSum.orders.map((o) => {
    const b = beforeCents.get(o.order) || 0;
    return {
      order: o.order,
      beforeCents: b,
      afterCents: o.materialCents,
      deltaCents: o.materialCents - b,
    };
  });

  const beforeStock = new Set(beforeSum.stockUsed);
  const afterStock = new Set(afterSum.stockUsed);

  return {
    cancelOrder,
    cancelled: { order: cancelOrder, beforeCents: beforeCents.get(cancelOrder) || 0 },
    before: beforeSum,
    after: afterSum,
    orders,
    diff: {
      standardBoards: afterSum.standardBoardsCount - beforeSum.standardBoardsCount,
      totalMaterialCents: afterSum.totalMaterialCents - beforeSum.totalMaterialCents,
      stockUsedAdded: afterSum.stockUsed.filter((id) => !beforeStock.has(id)),
      stockUsedRemoved: beforeSum.stockUsed.filter((id) => !afterStock.has(id)),
    },
  };
}

/**
 * 连续批次用料预演。
 * 输入 { batches: [排料输入, ...] }：每批为保存时的表单快照（与 cutBoards 相同的
 * 输入结构：订单清单 + 原板参数 + 可选单刀上限 / 余料回收尺寸 / 临时余板库存），
 * 按保存顺序逐批调用与 cutBoards 完全相同的排料规则。
 *
 * 余板池流转：
 *  - 首批快照的 stockBoards 作为初始余板池；后续各批自带的 stockBoards 不再入池，
 *    统一从上一批留下的余板池取料；
 *  - 每批结束后从池中扣除本批已用余板编号、保留未用余板；
 *  - 本批符合回收尺寸的余料（该批 offcuts 清单，已按该批最小回收尺寸筛选）逐项以
 *    「P{批次号}-{原余料编号}」入池供后续批次使用；与初始库存或已生成编号冲突时
 *    自动追加 -2、-3… 后缀避让，全程编号不重复。
 *
 * 返回 { batchesCount, totalStandardBoards, totalMaterialCents, finalPool, batches }：
 *  - batches[]：逐批汇总（新开标准板数、已用 / 新增余板、批末库存、本批与累计材料费）；
 *  - 任一批无法加工（零件放不下、刀长超限或输入非法）时抛 UserError 并指出批次号，
 *    不返回任何批次结果；预演为只读计算，不改动各批输入快照。
 */
function batchPreviewBoards(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }
  const rawBatches = input.batches;
  if (!Array.isArray(rawBatches) || rawBatches.length === 0) {
    throw new UserError('请至少保存一个批次再进行连续预演');
  }
  if (rawBatches.length > 50) {
    throw new UserError('批次数量过多（最多 50 批）');
  }

  let pool = []; // 当前余板池 [{ id, width, height, origin }]；origin=null 表示初始库存
  const seenIds = new Set(); // 历史全部余板编号（初始库存 + 各批回收生成），跨批不得冲突
  const batches = [];
  let totalStandardBoards = 0;
  let cumulativeMaterialCents = 0;

  // 余板池输出：编号、尺寸与来源（初始库存 / 第 N 批回收的余料编号）
  const poolRows = (list) => list.map((s) => ({
    id: s.id,
    width: round3(s.width),
    height: round3(s.height),
    ...(s.origin ? { fromBatch: s.origin.batch, fromOffcut: s.origin.offcut } : {}),
  }));

  for (let bi = 0; bi < rawBatches.length; bi++) {
    const batchNo = bi + 1;
    const raw = rawBatches[bi];

    // 首批：表单余板登记为初始库存（后续批次自带的 stockBoards 不入池）
    if (bi === 0) {
      let initial;
      try {
        initial = parseStockBoards(raw && typeof raw === 'object' ? raw.stockBoards : undefined);
      } catch (err) {
        if (err instanceof UserError) {
          throw new UserError(`第 1 批的初始余板库存无效：${err.message}`);
        }
        throw err;
      }
      pool = initial.map((s) => ({ ...s, origin: null }));
      for (const s of pool) seenIds.add(s.id);
    }
    const poolBeforeCount = pool.length;

    // 以当前余板池作为本批库存，调用与单次排料完全相同的规则
    let r;
    try {
      r = cutBoards({ ...(raw && typeof raw === 'object' ? raw : {}), stockBoards: pool });
    } catch (err) {
      if (err instanceof UserError) {
        throw new UserError(`第 ${batchNo} 批无法加工：${err.message}（连续预演已停止，未提交任何批次结果）`);
      }
      throw err;
    }

    // 从池中扣除本批已用余板编号，未用余板原样保留
    const usedIds = new Set(r.stockUsed.map((s) => s.id));
    pool = pool.filter((s) => !usedIds.has(s.id));

    // 本批符合回收尺寸的余料以「P批次号-原余料编号」入池，编号冲突自动避让
    const stockAdded = [];
    for (const oc of r.offcuts) {
      let id = `P${batchNo}-${oc.id}`;
      if (seenIds.has(id)) {
        let n = 2;
        while (seenIds.has(`${id}-${n}`)) n += 1;
        id = `${id}-${n}`;
      }
      seenIds.add(id);
      pool.push({
        id,
        width: oc.w,
        height: oc.h,
        origin: { batch: batchNo, offcut: oc.id },
      });
      stockAdded.push({
        id,
        fromOffcut: oc.id,
        fromBoard: oc.board,
        width: oc.w,
        height: oc.h,
      });
    }

    totalStandardBoards += r.standardBoardsCount;
    cumulativeMaterialCents += r.totalMaterialCents;

    batches.push({
      batch: batchNo,
      boardWidth: r.boardWidth,
      boardHeight: r.boardHeight,
      boardPrice: r.boardPrice,
      ordersCount: r.orders.length,
      totalParts: r.totalParts,
      boardsCount: r.boardsCount,
      standardBoardsCount: r.standardBoardsCount,
      materialCents: r.totalMaterialCents,
      cumulativeMaterialCents,
      poolBeforeCount,
      stockUsed: r.stockUsed,
      stockAdded,
      poolAfter: poolRows(pool),
    });
  }

  return {
    batchesCount: rawBatches.length,
    totalStandardBoards,
    totalMaterialCents: cumulativeMaterialCents,
    finalPool: poolRows(pool),
    batches,
  };
}

// 机台排程上限：仅接受不超过 8 张板的方案
const MAX_SCHEDULE_BOARDS = 8;
// 完工时间比较容差（秒）：吸收浮点误差，平局保留字典序更小的分配
const TIME_EPS = 1e-9;

/**
 * 机台排程核心（未舍入的内部结果）：供 scheduleBoards 与 electricityBoards 复用，
 * 保证分时电费核算沿用的排程与 /api/schedule 完全一致。
 * 返回 { N, machines（parseMachines 结果）, stats, dur, bestAssign, rows }，
 * rows[] 为逐板 { index, mi, start, end }（同一机台按板号顺序累计的未舍入秒数）。
 */
function computeSchedule(input, machines) {
  // 以输入快照重算裁切方案；排程为只读计算，不改动原排料结果
  const plan = cutBoards(input);
  if (plan.boardsCount > MAX_SCHEDULE_BOARDS) {
    throw new UserError(
      `方案共 ${plan.boardsCount} 张板，超过机台排程上限（${MAX_SCHEDULE_BOARDS} 张），无法进行机台排程`
    );
  }

  // 逐板加工参数：实际最长刀（决定可分配的机台）与全部刀长之和（耗时分子）
  const stats = plan.boards.map((b) => ({
    index: b.index,
    longestCut: b.longestCut,
    cutLength: b.cuts.reduce((s, c) => s + c.length, 0),
  }));

  // 板 b 可分配机台 m ⇔ 该板实际最长刀不超过该机台最大单刀长度
  const feasible = stats.map((st) =>
    machines.map((m) => st.longestCut <= m.maxCutLength + EPS)
  );
  stats.forEach((st, b) => {
    if (!feasible[b].some(Boolean)) {
      throw new UserError(
        `第 ${st.index} 张板的实际最长刀 ${round3(st.longestCut)} 超过全部机台的最大单刀长度` +
        `（${machines.map((m) => `「${m.name}」${round3(m.maxCutLength)}`).join('、')}），无可行机台`
      );
    }
  });

  // 板 b 在机台 m 上的耗时：每板准备秒数 + 刀长合计 ÷ 切割速度
  const N = stats.length;
  const M = machines.length;
  const dur = stats.map((st) =>
    machines.map((m) => m.setupSeconds + st.cutLength / m.speed)
  );

  // 遍历全部可行分配：按机台输入序号深度优先展开（即按“板号 → 机台输入序号”
  // 字典序枚举），仅在完工时间严格更小时更新，平局保留字典序最小的分配
  const assign = new Array(N).fill(0);
  const load = new Array(M).fill(0);
  let bestAssign = null;
  let bestMakespan = Infinity;
  const dfs = (b) => {
    if (b === N) {
      const makespan = Math.max(...load);
      if (makespan < bestMakespan - TIME_EPS) {
        bestMakespan = makespan;
        bestAssign = assign.slice();
      }
      return;
    }
    for (let m = 0; m < M; m++) {
      if (!feasible[b][m]) continue; // 超单刀上限的机台不可分配该板
      assign[b] = m;
      load[m] += dur[b][m];
      dfs(b + 1);
      load[m] -= dur[b][m];
    }
  };
  dfs(0);

  // 同一机台按板号顺序连续加工：按板号顺序逐板累计起止秒数
  const clock = new Array(M).fill(0);
  const machineEnd = new Array(M).fill(0);
  const machineBoards = machines.map(() => []);
  const rows = stats.map((st, b) => {
    const mi = bestAssign[b];
    const start = clock[mi];
    const end = start + dur[b][mi];
    clock[mi] = end;
    machineEnd[mi] = end;
    machineBoards[mi].push(st.index);
    return { index: st.index, mi, start, end };
  });

  return { N, machines, stats, dur, bestAssign, bestMakespan, rows, machineEnd, machineBoards };
}

/**
 * 机台开料排程。
 * 输入 = 排料输入（同 cutBoards，通常为生成方案时的表单快照）
 *      + machines: [{ name, maxCutLength, speed, setupSeconds }]（2～3 台）。
 *
 * 规则：
 *  - 以输入快照重算裁切方案（与生成方案时一致，原排料结果不受影响）；
 *    方案超过 8 张板时明确报错，不排程；
 *  - 每板不可拆分：板的实际最长刀超过某机台最大单刀长度时，该板不能分配给该机台；
 *    某板在全部机台上都超限时报错并指出板号；
 *  - 单板耗时 = 该机台每板准备秒数 + 该板全部刀长之和 ÷ 该机台切割速度；
 *  - 同一机台按板号顺序连续加工（无空转），机台完工时间 = 所分得各板耗时之和；
 *  - 遍历全部可行分配，取“全部板完成时间”（各机台完工时间的最大值）最小者；
 *    平局按“板号 → 机台输入序号”序列的字典序选取（按机台输入序号深度优先枚举，
 *    首次达到最小值的分配即字典序最小）。
 *
 * 返回 { boardsCount, machines, boards, makespan }：
 *  - machines[]：逐机台参数回显、分得的板号队列（按板号顺序）与完工秒数；
 *  - boards[]：逐板机台（名称与输入序号）、刀长合计、实际最长刀、单板耗时与起止秒数；
 *  - makespan：全部板完成时间（秒）。
 */
function scheduleBoards(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }
  const machines = parseMachines(input.machines);
  return formatSchedule(computeSchedule(input, machines), machines);
}

/**
 * 将 computeSchedule 的未舍入核心结果格式化为 /api/schedule 对外结构
 * （逐字段保留 3 位小数）。scheduleBoards 与 electricityBoards 共用此格式化，
 * 保证两处回显的排程严格一致。
 */
function formatSchedule(core) {
  const { N, machines, stats, dur, bestAssign, bestMakespan, rows, machineEnd, machineBoards } = core;
  const machineRows = machines.map((m, mi) => ({
    index: mi + 1,
    name: m.name,
    maxCutLength: round3(m.maxCutLength),
    speed: round3(m.speed),
    setupSeconds: round3(m.setupSeconds),
    boards: machineBoards[mi],
    end: round3(machineEnd[mi]),
  }));
  const boards = rows.map((r, b) => ({
    board: r.index,
    machine: machines[r.mi].name,
    machineIndex: r.mi + 1,
    cutLength: round3(stats[b].cutLength),
    longestCut: round3(stats[b].longestCut),
    duration: round3(dur[b][bestAssign[b]]),
    start: round3(r.start),
    end: round3(r.end),
  }));

  return {
    boardsCount: N,
    machines: machineRows,
    boards,
    makespan: round3(bestMakespan),
  };
}

// 输出统一保留位数
const round4 = (v) => Math.abs(v) < EPS ? 0 : Math.round(v * 10000) / 10000;
const round6 = (v) => Math.abs(v) < EPS ? 0 : Math.round(v * 1000000) / 1000000;
// 区间拆分时跳过浮点缝隙的容差（秒）
const SPLIT_EPS = 1e-7;

/**
 * 把绝对秒数（以机台开工当日 00:00 为原点）换算为实际时钟：
 * 返回 { day, time }，day 为相对开工当日的天序号（0=当日，1=次日…），
 * time 为 HH:mm:ss（含最多 3 位小数秒，无小数时省略）。
 * allowDay24=true 且时刻恰为某自然日 24:00 时保留为当日 24:00:00
 * （用于分段结束点）；否则归一到次日 00:00:00。
 */
function clockOf(absSecond, allowDay24 = false) {
  let t = absSecond;
  if (Math.abs(t - DAY_SECONDS) < 1e-6) t = DAY_SECONDS; // 消除浮点尾差
  const day = Math.floor(t / DAY_SECONDS + EPS);
  let s = t - day * DAY_SECONDS;
  if (s < 0) s = 0;
  let outDay = day;
  if (allowDay24 && day > 0 && Math.abs(s) < 1e-6) {
    // 自然日 24:00 = 次日 00:00；分段结束点保留为前一天的 24:00:00 更直观
    outDay = day - 1;
    s = DAY_SECONDS;
  }
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s - hh * 3600) / 60);
  const ss = s - hh * 3600 - mm * 60;
  let ssText = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':';
  const whole = Math.round(ss * 1000) / 1000;
  if (Math.abs(whole - Math.round(whole)) < 5e-4) {
    ssText += String(Math.round(whole)).padStart(2, '0');
  } else {
    const secInt = Math.floor(ss);
    let frac = String(Math.round((ss - secInt) * 1000)).padStart(3, '0');
    frac = frac.replace(/0+$/, '');
    ssText += `${String(secInt).padStart(2, '0')}.${frac}`;
  }
  return { day: outDay, time: ssText };
}

/**
 * 按分时电价边界拆分一个加工区间 [base + start, base + end]（绝对秒，
 * base = 机台开工当日 00:00 起到开工时刻的秒数）：
 * 跨电价边界或午夜时按日循环拆分，逐段匹配当日电价（午夜后循环回第一段）。
 * 返回 [{ startSec, endSec, startClock:{day,time}, endClock, seconds, price }]。
 */
function splitByTariff(base, start, end, tariff) {
  const segs = [];
  let cur = base + start;
  const finish = base + end;
  while (finish - cur > SPLIT_EPS) {
    const day = Math.floor(cur / DAY_SECONDS + EPS);
    const daySec = cur - day * DAY_SECONDS;
    const period = tariff.find((p) =>
      daySec + EPS >= p.startMinute * 60 && daySec < p.endMinute * 60 - EPS
    ) || tariff[tariff.length - 1];
    const nextBoundary = (day + 1) * DAY_SECONDS < finish + EPS
      ? Math.min((day + 1) * DAY_SECONDS, day * DAY_SECONDS + period.endMinute * 60, finish)
      : Math.min(day * DAY_SECONDS + period.endMinute * 60, finish);
    const segEnd = Math.min(nextBoundary, finish);
    if (segEnd - cur > SPLIT_EPS) {
      segs.push({
        startSec: cur,
        endSec: segEnd,
        startClock: clockOf(cur, false),
        endClock: clockOf(segEnd, true),
        seconds: segEnd - cur,
        price: period.price,
      });
    }
    cur = segEnd;
  }
  return segs;
}

/**
 * 分时电费核算。
 * 输入 = 排料输入快照 + machines（含 power 运行功率 kW 与 startTime 开工时刻 HH:mm）
 *      + tariffs: [{ start, end, price }]（一天内电价时段，无重叠完整覆盖 00:00～24:00）。
 *
 * 以同一输入快照与机台参数重算与 /api/schedule 完全一致的排程（原排料与原排程不变），
 * 把每板起止秒数叠加机台开工时刻换算为实际时刻；跨电价边界或午夜时按日循环拆分；
 * 分段费用 = 功率 × 加工秒数 ÷ 3600 × 电价；每板费用四舍五入到分（整数分）后再汇总。
 *
 * 返回 { tariffs, machines, boards, schedule, totalKwh, totalCents }：
 *  - schedule：与 /api/schedule 同构的排程结果（逐板起止秒数，不含计价）；
 *  - boards[]：逐板用电量 kWh、电费（整数分）与分段明细（实际时刻、秒数、电价）；
 *  - machines[]：逐机台开工时刻 / 功率、加工板号、完工时刻、用电量与电费；
 *  - totalKwh / totalCents：全部板用电量合计与电费合计（逐板整数分汇总，严格守恒）。
 */
function electricityBoards(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }
  const machines = parseMachines(input.machines, true);
  const tariff = parseTariffs(input.tariffs);
  const core = computeSchedule(input, machines);
  const { N, bestMakespan, rows, machineEnd, machineBoards } = core;

  const boardRows = rows.map((r) => {
    const m = machines[r.mi];
    const base = m.startMinute * 60;
    const rawSegs = splitByTariff(base, r.start, r.end, tariff);
    let rawCost = 0;
    const segments = rawSegs.map((sg) => {
      const kwh = m.power * sg.seconds / 3600;
      rawCost += kwh * sg.price; // 未舍入的分段费用（元），逐段累计
      return {
        startDay: sg.startClock.day,
        startTime: sg.startClock.time,
        endDay: sg.endClock.day,
        endTime: sg.endClock.time,
        seconds: round3(sg.seconds),
        price: round4(kwh * sg.price),
        kwh: round6(kwh),
        priceRate: sg.price,
      };
    });
    const kwh = m.power * (r.end - r.start) / 3600;
    // 每板金额四舍五入到分后再汇总（整数分，保证逐板合计严格等于总额）
    const costCents = Math.round(rawCost * 100);
    const startClock = clockOf(base + r.start);
    const endClock = clockOf(base + r.end);
    return {
      board: r.index,
      machine: m.name,
      machineIndex: r.mi + 1,
      start: round3(r.start),
      end: round3(r.end),
      startDay: startClock.day,
      startTime: startClock.time,
      endDay: endClock.day,
      endTime: endClock.time,
      kwh: round6(kwh),
      costCents,
      segments,
    };
  });

  const machineRows = machines.map((m, mi) => {
    const mb = boardRows.filter((b) => b.machineIndex === mi + 1);
    const kwh = mb.reduce((s, b) => s + b.kwh, 0);
    const costCents = mb.reduce((s, b) => s + b.costCents, 0);
    const base = m.startMinute * 60;
    const finishClock = machineBoards[mi].length ? clockOf(base + machineEnd[mi]) : null;
    return {
      index: mi + 1,
      name: m.name,
      power: round6(m.power),
      startTime: minuteToClock(m.startMinute),
      boards: machineBoards[mi],
      end: round3(machineEnd[mi]),
      finishDay: finishClock ? finishClock.day : 0,
      finishTime: finishClock ? finishClock.time : minuteToClock(m.startMinute),
      kwh: round6(kwh),
      costCents,
    };
  });

  // 回显的排程结果与 /api/schedule 完全一致
  const schedule = formatSchedule(core);

  return {
    tariffs: tariff.map((t) => ({ start: t.start, end: t.end, price: t.price })),
    boardsCount: N,
    makespan: round3(bestMakespan),
    machines: machineRows,
    boards: boardRows,
    schedule,
    totalKwh: round6(boardRows.reduce((s, b) => s + b.kwh, 0)),
    totalCents: boardRows.reduce((s, b) => s + b.costCents, 0),
  };
}

module.exports = {
  cutBoards,
  recutBoards,
  cancelPreviewBoards,
  batchPreviewBoards,
  scheduleBoards,
  electricityBoards,
  UserError,
};
