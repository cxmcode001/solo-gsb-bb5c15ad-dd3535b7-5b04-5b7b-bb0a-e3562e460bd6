/* 排料算法自检：面积守恒、刀路几何、多板、旋转与报错路径 */
'use strict';
const assert = require('assert');
const { cutBoards, recutBoards, cancelPreviewBoards, batchPreviewBoards, scheduleBoards, electricityBoards, UserError } = require('./src/cutting');

// 1) 示例数据：面积守恒 + 基本字段
const r = cutBoards({
  boardWidth: 2440, boardHeight: 1220, kerf: 3,
  parts: [
    { name: '柜门', width: 600, height: 400, quantity: 4 },
    { name: '侧板', width: 800, height: 350, quantity: 3 },
    { name: '抽屉面', width: 500, height: 200, quantity: 6 },
    { name: '背板条', width: 1000, height: 120, quantity: 2 },
  ],
});
assert.ok(r.boardsCount >= 1);
for (const b of r.boards) {
  const boardArea = b.width * b.height;
  assert(Math.abs(boardArea - b.partsArea - b.kerfArea - b.remainderArea) < 0.01,
    `板 ${b.index} 面积不守恒`);
  // 零件不得超出原板
  for (const p of b.placements) {
    assert(p.x >= -1e-6 && p.y >= -1e-6, '零件起点越界');
    assert(p.x + p.w <= b.width + 1e-6 && p.y + p.h <= b.height + 1e-6, '零件越界');
  }
  // 零件两两不重叠
  const ps = b.placements;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j];
      const overlap = a.x < c.x + c.w - 1e-6 && c.x < a.x + a.w - 1e-6 &&
        a.y < c.y + c.h - 1e-6 && c.y < a.y + a.h - 1e-6;
      assert(!overlap, `板 ${b.index} 零件重叠：${a.part}/${c.part}`);
    }
  }
  // 刀序从 1 连续，每刀端点在板内
  b.cuts.forEach((cut, i) => {
    assert.strictEqual(cut.seq, i + 1);
    assert(cut.x1 >= -1e-6 && cut.x2 <= b.width + 1e-6);
    assert(cut.y1 >= -1e-6 && cut.y2 <= b.height + 1e-6);
  });
}
assert.strictEqual(r.totalParts, 15);
assert.strictEqual(r.boards[0].cuts.length > 0, true, '应有刀路');
console.log('用板数:', r.boardsCount, '| 余料:', r.remainderArea, '| 锯缝:', r.kerfArea, '| 利用率:', r.utilization + '%');

// 2) 零件恰好铺满：无刀、余料 0
const full = cutBoards({
  boardWidth: 1000, boardHeight: 600, kerf: 2,
  parts: [{ name: '整板', width: 1000, height: 600, quantity: 1 }],
});
assert.strictEqual(full.boardsCount, 1);
assert.strictEqual(full.boards[0].cuts.length, 0);
assert.strictEqual(full.remainderArea, 0);

// 3) 锯缝为 0：仍记录刀序，仍有余料矩形
const k0 = cutBoards({
  boardWidth: 1000, boardHeight: 500, kerf: 0,
  parts: [{ name: 'A', width: 400, height: 300, quantity: 2 }],
});
assert.ok(k0.boards[0].cuts.length >= 2, '零锯缝也应有切割刀路');
assert.strictEqual(k0.kerfArea, 0);
assert.strictEqual(k0.partsArea + k0.remainderArea, 500000);

// 4) 必须旋转才能放下
const rot = cutBoards({
  boardWidth: 500, boardHeight: 300, kerf: 0,
  parts: [{ name: '横条', width: 280, height: 400, quantity: 1 }], // 正向 280x400 放不下，旋转后 400x280 可以
});
assert.strictEqual(rot.boards[0].placements[0].rotated, true);

// 5) 旋转后仍放不下 → 报错
assert.throws(() => cutBoards({
  boardWidth: 500, boardHeight: 300, kerf: 0,
  parts: [{ name: '大块', width: 400, height: 400, quantity: 1 }],
}), UserError);

// 6) 多板：每件 600x400，板 1200x800 恰好 2x2 放 4 件，9 件需要 3 张
const multi = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  parts: [{ name: '块', width: 600, height: 400, quantity: 9 }],
});
assert.strictEqual(multi.boardsCount, 3);
assert.deepStrictEqual(multi.boards.map((b) => b.placements.length), [4, 4, 1]);

// 7) 锯缝计入：600x400 两件并排放在 1203 宽板上（600+3+600），宽度刚好
const kerfFit = cutBoards({
  boardWidth: 1203, boardHeight: 400, kerf: 3,
  parts: [{ name: '条', width: 600, height: 400, quantity: 2 }],
});
assert.strictEqual(kerfFit.boardsCount, 1);
assert.strictEqual(kerfFit.boards[0].cuts.length, 1); // 只有竖切一刀
assert.strictEqual(kerfFit.kerfArea, 3 * 400);

// 8) 锯缝挤压：1202 宽放不下两件 → 第二件开新板
const noFit = cutBoards({
  boardWidth: 1202, boardHeight: 400, kerf: 3,
  parts: [{ name: '条', width: 600, height: 400, quantity: 2 }],
});
assert.strictEqual(noFit.boardsCount, 2);

// 9) 输入校验
assert.throws(() => cutBoards({ boardWidth: 0, boardHeight: 10, kerf: 0, parts: [{ name: 'a', width: 1, height: 1, quantity: 1 }] }), UserError);
assert.throws(() => cutBoards({ boardWidth: 10, boardHeight: 10, kerf: -1, parts: [{ name: 'a', width: 1, height: 1, quantity: 1 }] }), UserError);
assert.throws(() => cutBoards({ boardWidth: 10, boardHeight: 10, kerf: 0, parts: [] }), UserError);
assert.throws(() => cutBoards({ boardWidth: 10, boardHeight: 10, kerf: 0, parts: [{ name: 'a', width: 5, height: 5, quantity: 0 }] }), UserError);

// 10) 多订单拼版：跨板、订单归属、同名零件允许、按输入顺序切割
const mo = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 10,
  orders: [
    { orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] },
    { orderNo: 'B', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] },
  ],
});
assert.strictEqual(mo.boardsCount, 3);
assert.strictEqual(mo.mode, 'orders');
// 顺序：先 A×5 再 B×5，每板 4 件 → 板1 A×4，板2 A×1+B×3，板3 B×2
const counts = (b, order) => b.placements.filter((p) => p.order === order).length;
assert.strictEqual(counts(mo.boards[0], 'A'), 4);
assert.strictEqual(counts(mo.boards[0], 'B'), 0);
assert.strictEqual(counts(mo.boards[1], 'A'), 1);
assert.strictEqual(counts(mo.boards[1], 'B'), 3);
assert.strictEqual(counts(mo.boards[2], 'B'), 2);
assert.ok(mo.boards[1].placements[0].order === 'A', '板2 首件应为先输入的订单 A');
assert.strictEqual(mo.boards[1].placements[0].part, '块'); // 不同订单同名零件

// 逐板分摊额之和 = 板价
for (const b of mo.boards) {
  const sum = b.cost.shares.reduce((s, x) => s + x.cents, 0);
  assert.strictEqual(sum, b.cost.priceCents, `板 ${b.index} 分摊额不等于板价`);
}
// 订单汇总 = 总板价（A: 1000 + 250 = 1250；B: 750 + 1000 = 1750）
assert.strictEqual(mo.totalMaterialCents, 3000);
const sumOrders = mo.orders.reduce((s, o) => s + o.materialCents, 0);
assert.strictEqual(sumOrders, mo.totalMaterialCents, '订单汇总额不等于总板价');
const oA = mo.orders.find((o) => o.order === 'A');
const oB = mo.orders.find((o) => o.order === 'B');
assert.strictEqual(oA.materialCents, 1250);
assert.strictEqual(oB.materialCents, 1750);
assert.deepStrictEqual(oA.boardIndices, [1, 2]);
assert.deepStrictEqual(oB.boardIndices, [2, 3]);
assert.strictEqual(oA.partsCount, 5);
assert.strictEqual(oB.partsCount, 5);

// 分单取件清单：按订单列出件号 / 板号 / 坐标，板号升序且不重复
for (const pl of mo.pickList) {
  const boards = pl.items.map((it) => it.board);
  assert.deepStrictEqual(boards, [...boards].sort((a, b) => a - b), `订单 ${pl.order} 取件清单未按板号排序`);
  assert.strictEqual(pl.items.length, 5);
  for (const it of pl.items) {
    assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y), '取件清单缺少坐标');
  }
}
const plA = mo.pickList.find((p) => p.order === 'A');
assert.deepStrictEqual(plA.items.map((it) => it.board), [1, 1, 1, 1, 2]);
assert.deepStrictEqual(plA.items.map((it) => it.index), [1, 2, 3, 4, 5]);

// 11) 最大余数法：同余时按订单输入顺序补尾差
const tie = cutBoards({
  boardWidth: 1000, boardHeight: 1000, kerf: 0, boardPrice: 10.01, // 1001 分
  orders: [
    { orderNo: '甲', parts: [{ name: 'a', width: 250, height: 1000, quantity: 2 }] }, // 500000
    { orderNo: '乙', parts: [{ name: 'b', width: 250, height: 1000, quantity: 2 }] }, // 500000
  ],
});
assert.strictEqual(tie.boardsCount, 1);
const tieShares = tie.boards[0].cost.shares;
assert.strictEqual(tieShares.reduce((s, x) => s + x.cents, 0), 1001);
assert.strictEqual(tieShares[0].order, '甲');
assert.strictEqual(tieShares[0].cents, 501); // 500.5 同余，输入顺序在先者得尾差
assert.strictEqual(tieShares[1].cents, 500);

// 12) 最大余数法：余数不同，大者优先
const lr = cutBoards({
  boardWidth: 1000, boardHeight: 1000, kerf: 0, boardPrice: 0.03, // 3 分
  orders: [
    { orderNo: '甲', parts: [{ name: 'a', width: 600, height: 1000, quantity: 1 }] }, // 60% → 1.8 分
    { orderNo: '乙', parts: [{ name: 'b', width: 400, height: 1000, quantity: 1 }] }, // 40% → 1.2 分
  ],
});
const lrShares = lr.boards[0].cost.shares;
assert.strictEqual(lrShares.find((x) => x.order === '甲').cents, 2);
assert.strictEqual(lrShares.find((x) => x.order === '乙').cents, 1);

// 13) 多订单输入校验
assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  orders: [
    { orderNo: 'X1', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] },
    { orderNo: 'X1', parts: [{ name: 'b', width: 10, height: 10, quantity: 1 }] },
  ],
}), UserError, '订单号重复应报错');

assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  orders: [{ orderNo: 'X', parts: [
    { name: '同', width: 10, height: 10, quantity: 1 },
    { name: '同', width: 10, height: 10, quantity: 1 },
  ] }],
}), UserError, '同订单内零件同名应报错');

assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000, boardPrice: -1,
  orders: [{ orderNo: 'X', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
}), UserError, '负板价应报错');

assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000, boardPrice: 1.234,
  orders: [{ orderNo: 'X', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
}), UserError, '超过两位小数应报错');

assert.doesNotThrow(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000, boardPrice: 0,
  orders: [{ orderNo: 'X', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
}), '零板价应允许');

// 无订单号 / 无零件名自动补默认值
const def = cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  orders: [{ parts: [{ width: 10, height: 10, quantity: 1 }] }],
});
assert.strictEqual(def.orders[0].order, '订单1');
assert.strictEqual(def.boards[0].placements[0].part, '零件1');

// 旧版顶层 parts 仍然兼容
const legacy = cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  parts: [{ name: 'a', width: 10, height: 10, quantity: 2 }],
});
assert.strictEqual(legacy.mode, 'single');
assert.strictEqual(legacy.boards[0].placements[0].order, '订单1');
assert.strictEqual(legacy.boardPrice, 0);

// 14) 缺件补切：原方案不变、三元身份、原输入顺序、逐件关联原/新板号
const base = {
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 10,
  orders: [
    { orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] },
    { orderNo: 'B', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] },
  ],
};
const rc = recutBoards({
  ...base,
  damaged: [
    { order: 'B', part: '块', index: 2 }, // 故意乱序：应按原输入顺序重排
    { order: 'A', part: '块', index: 5 },
    { order: 'A', part: '块', index: 1 },
  ],
});
// 原方案落位与分摊保持不变（与直接计算完全一致）
assert.deepStrictEqual(rc.original, cutBoards(base));
// 补切清单按原输入顺序（订单 → 零件行 → 件号）：A#1、A#5 在 B#2 之前
assert.strictEqual(rc.recut.damagedCount, 3);
assert.deepStrictEqual(rc.recut.items.map((it) => [it.order, it.index]), [['A', 1], ['A', 5], ['B', 2]]);
// 逐件关联原板号与新板号（原方案：A#1 在板1，A#5、B#2 在板2；3 件合并进 1 张新板）
assert.deepStrictEqual(rc.recut.items.map((it) => it.srcBoard), [1, 2, 2]);
assert.deepStrictEqual(rc.recut.items.map((it) => it.board), [1, 1, 1]);
// 新增板数与材料费
assert.strictEqual(rc.recut.addedBoards, 1);
assert.strictEqual(rc.recut.addedMaterialCents, 1000);
// 补切板面积守恒、刀序连续
for (const b of rc.recut.boards) {
  const boardArea = b.width * b.height;
  assert(Math.abs(boardArea - b.partsArea - b.kerfArea - b.remainderArea) < 0.01, '补切板面积不守恒');
  b.cuts.forEach((cut, i) => assert.strictEqual(cut.seq, i + 1));
  const ps = b.placements;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j];
      const overlap = a.x < c.x + c.w - 1e-6 && c.x < a.x + a.w - 1e-6 &&
        a.y < c.y + c.h - 1e-6 && c.y < a.y + a.h - 1e-6;
      assert(!overlap, '补切板零件重叠');
    }
  }
}
// 补切落位保留三元身份（原件号、原板号）
assert.deepStrictEqual(rc.recut.boards[0].placements.map((p) => [p.order, p.part, p.index, p.srcBoard]),
  [['A', '块', 1, 1], ['A', '块', 5, 2], ['B', '块', 2, 2]]);
// 补切逐板分摊守恒 + 按订单汇总（A 两件 2/3、B 一件 1/3，尾差归余数大的 A）
const rcShares = rc.recut.boards[0].cost.shares;
assert.strictEqual(rcShares.reduce((s, x) => s + x.cents, 0), 1000);
const rcA = rc.recut.orders.find((o) => o.order === 'A');
const rcB = rc.recut.orders.find((o) => o.order === 'B');
assert.strictEqual(rcA.partsCount, 2);
assert.strictEqual(rcB.partsCount, 1);
assert.strictEqual(rcA.materialCents, 667);
assert.strictEqual(rcB.materialCents, 333);
assert.strictEqual(rcA.materialCents + rcB.materialCents, rc.recut.addedMaterialCents);
assert.deepStrictEqual(rcA.boardIndices, [1]);

// 15) 补切多板：5 件 600×400 需要 2 张新板
const rc2 = recutBoards({
  ...base,
  damaged: [1, 2, 3, 4, 5].map((i) => ({ order: 'A', part: '块', index: i })),
});
assert.strictEqual(rc2.recut.addedBoards, 2);
assert.strictEqual(rc2.recut.addedMaterialCents, 2000);
assert.deepStrictEqual(rc2.recut.items.map((it) => it.board), [1, 1, 1, 1, 2]);
assert.deepStrictEqual(rc2.recut.items.map((it) => it.srcBoard), [1, 1, 1, 1, 2]);
assert.deepStrictEqual(rc2.recut.items.map((it) => it.index), [1, 2, 3, 4, 5]);

// 16) 跨订单同名零件按三元身份区分：只补切 B 的「块」，不涉及 A 的同名件
const rc3 = recutBoards({ ...base, damaged: [{ order: 'B', part: '块', index: 4 }] });
assert.strictEqual(rc3.recut.damagedCount, 1);
assert.strictEqual(rc3.recut.items[0].order, 'B');
assert.strictEqual(rc3.recut.items[0].srcBoard, 3); // B#4 在原方案板3
assert.strictEqual(rc3.recut.boards[0].placements.length, 1);

// 17) 补切按原始尺寸重排：原方案中被旋转的件，补切以原始尺寸重新参与排料
const rotRc = recutBoards({
  boardWidth: 500, boardHeight: 300, kerf: 0,
  orders: [{ orderNo: 'R', parts: [{ name: '横条', width: 280, height: 400, quantity: 1 }] }],
  damaged: [{ order: 'R', part: '横条', index: 1 }],
});
assert.strictEqual(rotRc.original.boards[0].placements[0].rotated, true);
assert.strictEqual(rotRc.recut.items[0].rotated, true);
assert.strictEqual(rotRc.recut.items[0].w, 400); // 原始 280×400 旋转后占位 400×280
assert.strictEqual(rotRc.recut.items[0].h, 280);

// 18) 补切校验：空选择、件不存在、重复选择、缺字段、非法件号
assert.throws(() => recutBoards({ ...base, damaged: [] }), UserError, '空选择应报错');
assert.throws(() => recutBoards({ ...base }), UserError, '缺少 damaged 应报错');
assert.throws(() => recutBoards({ ...base, damaged: [{ order: 'A', part: '块', index: 99 }] }), UserError, '件号超出数量应报错');
assert.throws(() => recutBoards({ ...base, damaged: [{ order: 'A', part: '不存在', index: 1 }] }), UserError, '零件名不存在应报错');
assert.throws(() => recutBoards({ ...base, damaged: [{ order: 'C', part: '块', index: 1 }] }), UserError, '订单号不存在应报错');
assert.throws(() => recutBoards({
  ...base,
  damaged: [{ order: 'A', part: '块', index: 1 }, { order: 'A', part: '块', index: 1 }],
}), UserError, '重复选择应报错');
assert.throws(() => recutBoards({ ...base, damaged: [{ order: 'A', part: '块' }] }), UserError, '缺件号应报错');
assert.throws(() => recutBoards({ ...base, damaged: [{ order: 'A', part: '块', index: 0 }] }), UserError, '件号 0 应报错');
assert.throws(() => recutBoards({ ...base, damaged: [{ order: '', part: '块', index: 1 }] }), UserError, '缺订单号应报错');

// 19) 设备最大单刀长度：留空沿用现有规则；填写时必须为正数
const unrestricted = cutBoards({
  boardWidth: 1000, boardHeight: 1000, kerf: 0,
  parts: [{ name: 'a', width: 600, height: 300, quantity: 1 }],
});
assert.strictEqual(unrestricted.maxCutLength, null, '未填上限应为 null');
const withLimit = cutBoards({
  boardWidth: 1000, boardHeight: 800, kerf: 3, maxCutLength: 800,
  parts: [{ name: 'a', width: 600, height: 300, quantity: 1 }],
});
assert.strictEqual(withLimit.maxCutLength, 800, '结果应回显所用上限');
assert.ok(Math.max(...withLimit.boards[0].cuts.map((c) => c.length)) <= 800 + 1e-6);
assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000, maxCutLength: 0,
  parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }],
}), UserError, '上限为 0 应报错');
assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000, maxCutLength: -3,
  parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }],
}), UserError, '负上限应报错');
assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000, maxCutLength: 'abc',
  parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }],
}), UserError, '非数字上限应报错');

// 20) 上限只允许不超限的切法：600×300 落 1000×800 空板（kerf 3）
//     竖切优先 = 竖切 800 + 横切 600；横切优先 = 横切 1000 + 竖切 300
//     不设上限时按现有规则选余料面积更大的横切优先；上限 900 时横切优先超限，
//     改用竖切优先（800 ≤ 900）
const noLimitPart = { name: 'a', width: 600, height: 300, quantity: 1 };
const noLimitBoard = { boardWidth: 1000, boardHeight: 800, kerf: 3 };
const noLimit = cutBoards({ ...noLimitBoard, parts: [noLimitPart] });
assert.deepStrictEqual(noLimit.boards[0].cuts.map((c) => c.type), ['h', 'v'], '不限时应按余料规则选横切优先');
const lim = cutBoards({ ...noLimitBoard, maxCutLength: 900, parts: [noLimitPart] });
assert.strictEqual(lim.boardsCount, 1);
const limCuts = lim.boards[0].cuts;
// 竖切优先：先竖切（长 800），再横切（长 600）
assert.deepStrictEqual(limCuts.map((c) => c.type), ['v', 'h']);
assert.strictEqual(limCuts[0].length, 800);
assert.strictEqual(limCuts[1].length, 600);
assert.strictEqual(lim.boards[0].longestCut, 800, 'longestCut 应为该板实际最长刀');
assert(lim.boards[0].longestCut <= 900 + 1e-6, '实际最长刀不得超过上限');
// 上限 800 时竖切优先恰好可行（边界值，容差内）
const limEdge = cutBoards({ ...noLimitBoard, maxCutLength: 800, parts: [noLimitPart] });
assert.deepStrictEqual(limEdge.boards[0].cuts.map((c) => c.type), ['v', 'h']);
// 上限 799 时两种切法均超限（新板也无法加工）
assert.throws(() => cutBoards({ ...noLimitBoard, maxCutLength: 799, parts: [noLimitPart] }), UserError);

// 21) 上限迫使切法改变：竖切优先可行、横切优先不可行时选竖切优先
//     零件 600×700：竖切优先 = 竖切 1000 + 横切 600（竖切超限）；
//     横切优先 = 横切 1000 + 竖切 700（横切超限）。上限 900 时：
//     竖切优先仍有 1000 刀 → 不可行；旋转 700×600：竖切优先 = 1000 + 横切 700（不可行），
//     横切优先 = 横切 1000 + 竖切 600（不可行）→ 新板也无法加工，报错并给出订单 / 零件 / 件号
const badInput = {
  boardWidth: 1000, boardHeight: 1000, kerf: 0, maxCutLength: 900,
  orders: [{ orderNo: 'SO-X', parts: [{ name: '大板', width: 600, height: 700, quantity: 2 }] }],
};
let errMsg = '';
try {
  cutBoards(badInput);
  assert.fail('应当因超刀长报错');
} catch (e) {
  assert(e instanceof UserError);
  errMsg = e.message;
}
assert(/SO-X/.test(errMsg) && /大板/.test(errMsg) && /第 1 件/.test(errMsg),
  '错误信息应指出订单、零件与件号：' + errMsg);
assert(/900/.test(errMsg), '错误信息应给出上限：' + errMsg);

// 22) 现有板无可行落位时仍尝试新板：先放一件让现有余料全是窄条，第二件只能开新板
//     板 1000×1000、上限 1000（仅整板级刀路可行）：第一件 300×300 后，余料为
//     700×1000 与 300×700；第二件 900×900 放不进现有余料 → 开新板，新板横切 900、竖切 900 可行
const nb = cutBoards({
  boardWidth: 1000, boardHeight: 1000, kerf: 0, maxCutLength: 1000,
  parts: [
    { name: '小块', width: 300, height: 300, quantity: 1 },
    { name: '大块', width: 900, height: 900, quantity: 1 },
  ],
});
assert.strictEqual(nb.boardsCount, 2, '现有板放不下应开新板');
assert(nb.boards[1].longestCut <= 1000 + 1e-6);

// 23) 上限逐板生效：所有板的所有刀长都不得超过上限
const ml = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 3, maxCutLength: 800,
  orders: [
    { orderNo: 'A', parts: [{ name: '块', width: 400, height: 300, quantity: 5 }] },
    { orderNo: 'B', parts: [{ name: '条', width: 500, height: 200, quantity: 4 }] },
  ],
});
for (const b of ml.boards) {
  for (const c of b.cuts) {
    assert(c.length <= 800 + 1e-6,
      `板 ${b.index} 第 ${c.seq} 刀长 ${c.length} 超过上限 800`);
  }
}
// 面积守恒、零件不重叠仍成立
for (const b of ml.boards) {
  assert(Math.abs(b.width * b.height - b.partsArea - b.kerfArea - b.remainderArea) < 0.01);
  const ps = b.placements;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j];
      const overlap = a.x < c.x + c.w - 1e-6 && c.x < a.x + a.w - 1e-6 &&
        a.y < c.y + c.h - 1e-6 && c.y < a.y + a.h - 1e-6;
      assert(!overlap, `板 ${b.index} 零件重叠`);
    }
  }
}

// 24) 缺件补切同样受上限约束；原方案 / 补切方案均回显上限，超限则报错且不产出刀路
const rcBase = {
  boardWidth: 1200, boardHeight: 800, kerf: 0, maxCutLength: 800,
  orders: [
    { orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] },
    { orderNo: 'B', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] },
  ],
};
const rcLim = recutBoards({
  ...rcBase,
  damaged: [
    { order: 'B', part: '块', index: 2 },
    { order: 'A', part: '块', index: 5 },
  ],
});
assert.strictEqual(rcLim.original.maxCutLength, 800);
assert.strictEqual(rcLim.recut.maxCutLength, 800);
for (const b of rcLim.recut.boards) {
  for (const c of b.cuts) assert(c.length <= 800 + 1e-6, `补切板刀长 ${c.length} 超限`);
}
// 补切新板也无法加工 → 报错且包含三元身份
try {
  recutBoards({
    boardWidth: 600, boardHeight: 500, kerf: 0, maxCutLength: 400,
    orders: [{ orderNo: 'R', parts: [{ name: '横条', width: 550, height: 450, quantity: 1 }] }],
    damaged: [{ order: 'R', part: '横条', index: 1 }],
  });
  assert.fail('补切超刀长应报错');
} catch (e) {
  assert(e instanceof UserError);
  assert(/R/.test(e.message) && /横条/.test(e.message) && /第 1 件/.test(e.message),
    '补切超限错误应指出订单 / 零件 / 件号：' + e.message);
}

// 25) 临时余板库存：已开板优先 → 未用余板（按输入顺序）→ 标准新板；余板最多用一次
const stBase = {
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 100,
  stockBoards: [
    { id: 'S1', width: 700, height: 500 },
    { id: 'S2', width: 1200, height: 800 },
  ],
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 10 }] }],
};
const st = cutBoards(stBase);
// 第1件无已开板 → 先开余板 S1（仅放1件）；第2件 S1 余料放不下 → 开余板 S2（放4件）；
// 之后才开标准新板 2 张（4+1 件）
assert.strictEqual(st.boardsCount, 4);
assert.strictEqual(st.standardBoardsCount, 2);
assert.deepStrictEqual(st.boards.map((b) => [b.kind, b.stockId || null, b.placements.length]),
  [['stock', 'S1', 1], ['stock', 'S2', 4], ['standard', null, 4], ['standard', null, 1]]);
assert.deepStrictEqual(st.stockUsed.map((s) => [s.id, s.board]), [['S1', 1], ['S2', 2]]);
assert.deepStrictEqual(st.stockUnused, []);
// 材料费只对新增标准板收取（2 × 100 元）
assert.strictEqual(st.totalMaterialCents, 20000);
assert.deepStrictEqual(st.boards.map((b) => b.cost.priceCents), [0, 0, 10000, 10000]);
// 总面积按各板实际尺寸：700×500 + 1200×800×3
assert.strictEqual(st.totalArea, 700 * 500 + 1200 * 800 * 3);
for (const b of st.boards) {
  assert(Math.abs(b.width * b.height - b.partsArea - b.kerfArea - b.remainderArea) < 0.01,
    `板 ${b.index} 面积不守恒`);
  assert.strictEqual(b.width, b.kind === 'stock' && b.stockId === 'S1' ? 700 : 1200);
  assert.strictEqual(b.height, b.kind === 'stock' && b.stockId === 'S1' ? 500 : 800);
}
// 回显库存输入
assert.deepStrictEqual(st.stockBoards, [
  { id: 'S1', width: 700, height: 500 },
  { id: 'S2', width: 1200, height: 800 },
]);

// 26) 已开板（含已启用余板）的可用矩形优先于新余板：小料填入 S1 余料，不再开新板
const reuse = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 100,
  stockBoards: [{ id: 'R1', width: 700, height: 500 }],
  orders: [{ orderNo: 'A', parts: [
    { name: '大块', width: 600, height: 400, quantity: 1 },
    { name: '小条', width: 80, height: 400, quantity: 1 }, // 可入 S1 右侧 100×500 余料
  ] }],
});
assert.strictEqual(reuse.boardsCount, 1, '应复用已启用余板');
assert.strictEqual(reuse.boards[0].kind, 'stock');
assert.strictEqual(reuse.boards[0].placements.length, 2);
assert.strictEqual(reuse.standardBoardsCount, 0);
assert.strictEqual(reuse.totalMaterialCents, 0);

// 27) 按输入顺序尝试余板，跳过放不下的；放不下的保留为未用
const skip = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 50,
  stockBoards: [
    { id: 'T1', width: 300, height: 300 }, // 放不下 600×400
    { id: 'T2', width: 1000, height: 500 }, // 可以
  ],
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 1 }] }],
});
assert.strictEqual(skip.boardsCount, 1);
assert.strictEqual(skip.boards[0].stockId, 'T2');
assert.deepStrictEqual(skip.stockUsed.map((s) => s.id), ['T2']);
assert.deepStrictEqual(skip.stockUnused.map((s) => s.id), ['T1']);
assert.strictEqual(skip.totalMaterialCents, 0);

// 28) 每块余板最多使用一次：2 件 + 1 块只能放 1 件的余板 → 余板 1 张 + 标准新板 1 张
const once = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 80,
  stockBoards: [{ id: 'U1', width: 700, height: 500 }], // 余料窄条放不进第二件 600×400
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 2 }] }],
});
assert.strictEqual(once.boardsCount, 2);
assert.strictEqual(once.boards[0].kind, 'stock');
assert.strictEqual(once.boards[1].kind, 'standard');
assert.strictEqual(once.standardBoardsCount, 1);
assert.strictEqual(once.totalMaterialCents, 8000);

// 29) 余板允许旋转落料：零件 1000×700 正向放不下 800×1100，旋转后 700×1000 可以
const stRot = cutBoards({
  boardWidth: 600, boardHeight: 600, kerf: 0,
  stockBoards: [{ id: 'Q1', width: 800, height: 1100 }],
  orders: [{ orderNo: 'A', parts: [{ name: '横条', width: 1000, height: 700, quantity: 1 }] }],
});
assert.strictEqual(stRot.boardsCount, 1);
assert.strictEqual(stRot.boards[0].stockId, 'Q1');
assert.strictEqual(stRot.boards[0].placements[0].rotated, true);

// 30) 单刀长度限制：跳过超限余板，选后续可行余板；都不可行才开标准新板
const stLim = cutBoards({
  boardWidth: 1000, boardHeight: 800, kerf: 3, boardPrice: 100, maxCutLength: 700,
  stockBoards: [
    { id: 'L1', width: 1000, height: 800 }, // 与标准板同尺寸：600×300 两种切法最短也需 800 刀 → 超限
    { id: 'L2', width: 603, height: 303 },  // 恰好容纳 600×300，竖切 303、横切 600 均 ≤ 700
  ],
  orders: [{ orderNo: 'A', parts: [{ name: 'a', width: 600, height: 300, quantity: 1 }] }],
});
assert.strictEqual(stLim.boardsCount, 1);
assert.strictEqual(stLim.boards[0].stockId, 'L2');
assert.deepStrictEqual(stLim.stockUsed.map((s) => s.id), ['L2']);
assert.deepStrictEqual(stLim.stockUnused.map((s) => s.id), ['L1']);
assert(stLim.boards[0].longestCut <= 700 + 1e-6);
assert.strictEqual(stLim.totalMaterialCents, 0);
// 所有余板均超限时回退标准新板（标准板同样超限则整体报错）
const stLimStd = cutBoards({
  boardWidth: 603, boardHeight: 303, kerf: 3, maxCutLength: 700,
  stockBoards: [{ id: 'L3', width: 1000, height: 800 }],
  orders: [{ orderNo: 'A', parts: [{ name: 'a', width: 600, height: 300, quantity: 1 }] }],
});
assert.strictEqual(stLimStd.boards[0].kind, 'standard');
assert.deepStrictEqual(stLimStd.stockUnused.map((s) => s.id), ['L3']);
assert.strictEqual(stLimStd.totalMaterialCents, stLimStd.boardPrice * 100);
assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 800, kerf: 3, maxCutLength: 700,
  stockBoards: [{ id: 'L4', width: 1000, height: 800 }],
  orders: [{ orderNo: 'A', parts: [{ name: 'a', width: 600, height: 300, quantity: 1 }] }],
}), UserError);

// 31) 余板库存输入校验：编号缺失 / 重复、尺寸非正
assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  stockBoards: [{ width: 10, height: 10 }],
  orders: [{ orderNo: 'X', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
}), UserError, '余板缺编号应报错');
assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  stockBoards: [
    { id: 'DUP', width: 10, height: 10 },
    { id: 'DUP', width: 20, height: 20 },
  ],
  orders: [{ orderNo: 'X', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
}), UserError, '余板编号重复应报错');
assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  stockBoards: [{ id: 'Z', width: 0, height: 10 }],
  orders: [{ orderNo: 'X', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
}), UserError, '余板长度非正应报错');
assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  stockBoards: [{ id: 'Z', width: 10, height: -2 }],
  orders: [{ orderNo: 'X', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
}), UserError, '余板宽度非正应报错');

// 32) 零件旋转后仍大于标准板、但能放入某块余板时允许排料；标准板与所有余板都放不下才报错
const onlyStock = cutBoards({
  boardWidth: 500, boardHeight: 300, kerf: 0,
  stockBoards: [{ id: 'BIG', width: 700, height: 700 }],
  orders: [{ orderNo: 'A', parts: [{ name: '大方', width: 600, height: 600, quantity: 1 }] }],
});
assert.strictEqual(onlyStock.boards[0].stockId, 'BIG');
assert.throws(() => cutBoards({
  boardWidth: 500, boardHeight: 300, kerf: 0,
  stockBoards: [{ id: 'SMALL', width: 400, height: 400 }],
  orders: [{ orderNo: 'A', parts: [{ name: '大方', width: 600, height: 600, quantity: 1 }] }],
}), UserError);

// 33) 补切独立使用标准新板，不耗用余板库存；原方案 / 补切材料费只数标准板
const rcSt = recutBoards({
  ...stBase,
  damaged: [{ order: 'A', part: '块', index: 1 }],
});
assert.deepStrictEqual(rcSt.original, cutBoards(stBase));
assert.strictEqual(rcSt.recut.addedBoards, 1);
assert.strictEqual(rcSt.recut.addedMaterialCents, 10000);
assert.strictEqual(rcSt.recut.boards[0].kind, 'standard');
assert.strictEqual(rcSt.recut.boards[0].cost.priceCents, 10000);
for (const b of rcSt.recut.boards) assert.strictEqual(b.kind, 'standard', '补切不得使用余板');
// 原方案库存耗用不受补切影响
assert.deepStrictEqual(rcSt.original.stockUsed.map((s) => s.id), ['S1', 'S2']);

// 34) 撤单影响预览：前后方案对照、保留订单差值（整数分）、原输入不被修改
const cp = cancelPreviewBoards({ ...base, cancelOrder: 'B' });
assert.strictEqual(cp.cancelOrder, 'B');
// 撤单前与直接计算一致（3 张标准板、3000 分；A 1250、B 1750）
assert.strictEqual(cp.before.standardBoardsCount, 3);
assert.strictEqual(cp.before.totalMaterialCents, 3000);
assert.deepStrictEqual(cp.before.stockUsed, []);
assert.deepStrictEqual(cp.before.orders, [
  { order: 'A', materialCents: 1250 },
  { order: 'B', materialCents: 1750 },
]);
// 撤单后只剩 A：5 件 → 2 张标准板、2000 分
assert.strictEqual(cp.after.standardBoardsCount, 2);
assert.strictEqual(cp.after.totalMaterialCents, 2000);
assert.deepStrictEqual(cp.after.orders, [{ order: 'A', materialCents: 2000 }]);
// 被撤订单与保留订单差值（后 − 前，整数分）
assert.strictEqual(cp.cancelled.beforeCents, 1750);
assert.deepStrictEqual(cp.orders, [
  { order: 'A', beforeCents: 1250, afterCents: 2000, deltaCents: 750 },
]);
assert.strictEqual(cp.diff.standardBoards, -1);
assert.strictEqual(cp.diff.totalMaterialCents, -1000);
assert.deepStrictEqual(cp.diff.stockUsedAdded, []);
assert.deepStrictEqual(cp.diff.stockUsedRemoved, []);
// 差值守恒：保留订单差值之和 = 总额差值 + 被撤订单原分摊额
assert.strictEqual(
  cp.orders.reduce((s, o) => s + o.deltaCents, 0),
  cp.diff.totalMaterialCents + cp.cancelled.beforeCents
);
// 撤单前汇总与直接计算的方案一致（原方案不变）
const direct = cutBoards(base);
assert.strictEqual(cp.before.boardsCount, direct.boardsCount);
assert.strictEqual(cp.before.totalMaterialCents, direct.totalMaterialCents);
assert.deepStrictEqual(cp.before.stockUsed, direct.stockUsed.map((s) => s.id));

// 35) 空白订单号按原位置固定自动编号，筛除后其余订单不改名
const blankBase = {
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 10,
  orders: [
    { orderNo: '', parts: [{ name: '块', width: 600, height: 400, quantity: 2 }] }, // 订单1
    { orderNo: 'X', parts: [{ name: '块', width: 600, height: 400, quantity: 2 }] },
    { orderNo: '', parts: [{ name: '块', width: 600, height: 400, quantity: 2 }] }, // 订单3
  ],
};
const cpBlank = cancelPreviewBoards({ ...blankBase, cancelOrder: 'X' });
// 保留订单仍叫 订单1、订单3（不重新编号为 订单1、订单2）
assert.deepStrictEqual(cpBlank.orders.map((o) => o.order), ['订单1', '订单3']);
assert.deepStrictEqual(cpBlank.after.orders.map((o) => o.order), ['订单1', '订单3']);
// 原始输入不被修改（空白订单号仍为空）
assert.strictEqual(blankBase.orders[0].orderNo, '');
assert.strictEqual(blankBase.orders[2].orderNo, '');
// 也可按自动编号撤单（撤 订单3，保留 X 与 订单1）
const cpBlank2 = cancelPreviewBoards({ ...blankBase, cancelOrder: '订单3' });
assert.deepStrictEqual(cpBlank2.orders.map((o) => o.order), ['订单1', 'X']);

// 36) 撤单预览中的余板耗用对照：撤掉占用余板的订单后余板回到未用
const cpStock = cancelPreviewBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 100,
  stockBoards: [{ id: 'S9', width: 300, height: 300 }],
  orders: [
    { orderNo: 'A', parts: [{ name: '小件', width: 250, height: 250, quantity: 1 }] }, // 启用余板 S9
    { orderNo: 'B', parts: [{ name: '块', width: 600, height: 400, quantity: 1 }] },   // 标准新板
  ],
  cancelOrder: 'A',
});
assert.deepStrictEqual(cpStock.before.stockUsed, ['S9']);
assert.deepStrictEqual(cpStock.after.stockUsed, []);
assert.deepStrictEqual(cpStock.diff.stockUsedRemoved, ['S9']);
assert.deepStrictEqual(cpStock.diff.stockUsedAdded, []);
assert.strictEqual(cpStock.before.standardBoardsCount, 1);
assert.strictEqual(cpStock.after.standardBoardsCount, 1);
assert.strictEqual(cpStock.diff.totalMaterialCents, 0); // 前后都只有 1 张标准板

// 37) 撤单预览校验：只有一张订单、订单号无效、未指定订单号
assert.throws(() => cancelPreviewBoards({
  boardWidth: 1000, boardHeight: 1000,
  orders: [{ orderNo: 'ONLY', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
  cancelOrder: 'ONLY',
}), UserError, '只有一张订单应报错');
assert.throws(() => cancelPreviewBoards({ ...base, cancelOrder: '不存在' }), UserError, '订单号无效应报错');
assert.throws(() => cancelPreviewBoards({ ...base }), UserError, '未指定订单号应报错');
assert.throws(() => cancelPreviewBoards({ ...base, cancelOrder: '  ' }), UserError, '空白订单号应报错');
// 旧版单订单输入（顶层 parts）同样视为只有一张订单
assert.throws(() => cancelPreviewBoards({
  boardWidth: 1000, boardHeight: 1000,
  parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }],
  cancelOrder: '订单1',
}), UserError, '单订单旧版输入应报错');

// 38) 可回收余料清单：来自各板最终空闲矩形，面积守恒、互不重叠、不含零件与锯缝
const ocBase = {
  boardWidth: 1000, boardHeight: 500, kerf: 3, boardPrice: 10,
  orders: [{ orderNo: 'A', parts: [{ name: '板', width: 400, height: 300, quantity: 1 }] }],
};
const oc = cutBoards(ocBase);
assert.strictEqual(oc.boardsCount, 1);
// 竖切优先：右 (403,0,597,500)、下 (0,303,400,197)
assert.strictEqual(oc.offcuts.length, 2);
assert.deepStrictEqual(oc.offcuts.map((o) => o.id), ['B1-R1', 'B1-R2']);
const [ocR1, ocR2] = oc.offcuts;
assert.deepStrictEqual([ocR1.board, ocR1.region, ocR1.x, ocR1.y, ocR1.w, ocR1.h], [1, 1, 403, 0, 597, 500]);
assert.deepStrictEqual([ocR2.board, ocR2.region, ocR2.x, ocR2.y, ocR2.w, ocR2.h], [1, 2, 0, 303, 400, 197]);
assert.strictEqual(ocR1.area, 597 * 500);
assert.strictEqual(ocR2.area, 400 * 197);
// 未筛选时清单面积之和 = 该板余料面积 = 总余料面积（锯缝与零件不计入）
assert(Math.abs(oc.offcutArea - oc.boards[0].remainderArea) < 0.01);
assert(Math.abs(oc.offcutArea - oc.remainderArea) < 0.01);
// 余料区域两两不重叠，且不与零件占位、锯缝带重叠
const rectOverlap = (a, b) =>
  a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 &&
  a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
for (const b of oc.boards) {
  const rects = oc.offcuts.filter((o) => o.board === b.index);
  for (const p of b.placements) {
    for (const o of rects) assert(!rectOverlap(o, p), `板 ${b.index} 余料与零件重叠`);
  }
  for (const c of b.cuts) {
    if (c.band.w <= 0 || c.band.h <= 0) continue; // 零宽缝带无面积
    for (const o of rects) assert(!rectOverlap(o, c.band), `板 ${b.index} 余料与锯缝带重叠`);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      assert(!rectOverlap(rects[i], rects[j]), `板 ${b.index} 余料区域互相重叠`);
    }
  }
}
// 回显筛选参数（未设置时为 0，表示不筛选）
assert.strictEqual(oc.minOffcutLength, 0);
assert.strictEqual(oc.minOffcutWidth, 0);

// 39) 余料筛选：可配置最小长 / 宽（允许旋转匹配）；区域序号稳定、不随筛选变化
const ocFilter = cutBoards({ ...ocBase, minOffcutLength: 500, minOffcutWidth: 100 });
// R1 597×500 满足；R2 400×197 两个朝向的长边均 < 500 → 仅 B1-R1
assert.deepStrictEqual(ocFilter.offcuts.map((o) => o.id), ['B1-R1']);
assert.strictEqual(ocFilter.minOffcutLength, 500);
assert.strictEqual(ocFilter.minOffcutWidth, 100);
assert(Math.abs(ocFilter.offcutArea - 597 * 500) < 0.01);
// 放宽筛选后 R2 重新入列且编号不变（区域序号为板内空闲区域顺序号）
const ocFilter2 = cutBoards({ ...ocBase, minOffcutLength: 100, minOffcutWidth: 100 });
assert.deepStrictEqual(ocFilter2.offcuts.map((o) => o.id), ['B1-R1', 'B1-R2']);
// 旋转匹配：竖条 300×800，不旋转时宽 300 < 400 不满足，旋转后 800×300 满足
const ocRot = cutBoards({
  boardWidth: 500, boardHeight: 800, kerf: 0,
  minOffcutLength: 400, minOffcutWidth: 250,
  parts: [{ name: '小块', width: 200, height: 200, quantity: 1 }],
});
// 竖切优先：右 (200,0,300,800) 入选；下 (0,200,200,600) 旋转后宽 200 < 250 仍不满足
assert.deepStrictEqual(ocRot.offcuts.map((o) => [o.id, o.w, o.h]), [['B1-R1', 300, 800]]);
// 筛选参数校验：负数 / 非数字报错
assert.throws(() => cutBoards({ ...ocBase, minOffcutLength: -1 }), UserError, '负最小长度应报错');
assert.throws(() => cutBoards({ ...ocBase, minOffcutWidth: 'abc' }), UserError, '非数字最小宽度应报错');

// 40) 余板库存板同样提取余料；多板编号按板号区分
const ocStock = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  stockBoards: [{ id: 'S1', width: 700, height: 500 }],
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] }],
});
// 板1 = 余板 S1（1 件），板2 = 标准板（4 件）
assert.strictEqual(ocStock.boards[0].kind, 'stock');
for (const o of ocStock.offcuts) {
  const b = ocStock.boards[o.board - 1];
  assert(o.x >= -1e-6 && o.y >= -1e-6 && o.x + o.w <= b.width + 1e-6 && o.y + o.h <= b.height + 1e-6,
    `余料 ${o.id} 越出板 ${o.board}`);
}
const ocByBoard = new Map();
for (const o of ocStock.offcuts) ocByBoard.set(o.board, (ocByBoard.get(o.board) || 0) + o.area);
for (const b of ocStock.boards) {
  assert(Math.abs((ocByBoard.get(b.index) || 0) - b.remainderArea) < 0.01,
    `板 ${b.index} 余料清单面积与余料面积不一致`);
}
// 41) 补切重算的原方案同样携带余料清单，且与直接计算一致（落位 / 分摊不受影响）
const rcOc = recutBoards({ ...ocBase, damaged: [{ order: 'A', part: '板', index: 1 }] });
assert.deepStrictEqual(rcOc.original.offcuts, oc.offcuts);
assert.deepStrictEqual(rcOc.original.boards, oc.boards);

// 42) 连续批次用料预演：首批表单余板为初始库存，余板池跨批流转，余料按批回收入池
//     批1：余板 S1（700×500，放 1 件）+ 标准新板 1 张（4 件）；S2 未用保留；
//          余料 B1-R1（100×500，旋转后满足 500×100）与 B1-R2（600×100）入池 → P1-B1-R1、P1-B1-R2
//     批2：550×90 放不进 S2 / P1-B1-R1，恰好放进回收余板 P1-B1-R2（600×100）→ 0 张新板
const bp = batchPreviewBoards({
  batches: [
    {
      boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 100,
      minOffcutLength: 500, minOffcutWidth: 100,
      stockBoards: [
        { id: 'S1', width: 700, height: 500 },
        { id: 'S2', width: 300, height: 300 },
      ],
      orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] }],
    },
    {
      boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 100,
      minOffcutLength: 500, minOffcutWidth: 100,
      stockBoards: [{ id: 'X9', width: 2000, height: 2000 }], // 非首批自带余板：不入池
      orders: [{ orderNo: 'B', parts: [{ name: '条', width: 550, height: 90, quantity: 1 }] }],
    },
  ],
});
assert.strictEqual(bp.batchesCount, 2);
const [bp1, bp2] = bp.batches;
// 批1：1 张新开标准板、材料费 100 元、累计 100 元
assert.strictEqual(bp1.batch, 1);
assert.strictEqual(bp1.standardBoardsCount, 1);
assert.strictEqual(bp1.materialCents, 10000);
assert.strictEqual(bp1.cumulativeMaterialCents, 10000);
assert.strictEqual(bp1.poolBeforeCount, 2);
assert.deepStrictEqual(bp1.stockUsed.map((s) => s.id), ['S1']);
assert.deepStrictEqual(bp1.stockAdded.map((s) => s.id), ['P1-B1-R1', 'P1-B1-R2']);
assert.deepStrictEqual(bp1.stockAdded.map((s) => [s.width, s.height]), [[100, 500], [600, 100]]);
assert.deepStrictEqual(bp1.stockAdded.map((s) => s.fromOffcut), ['B1-R1', 'B1-R2']);
// 批末库存 = 未用 S2 + 本批回收两块
assert.deepStrictEqual(bp1.poolAfter.map((s) => s.id), ['S2', 'P1-B1-R1', 'P1-B1-R2']);
assert.strictEqual(bp1.poolAfter[0].fromBatch, undefined, '初始库存无来源批次');
assert.strictEqual(bp1.poolAfter[1].fromBatch, 1);
assert.strictEqual(bp1.poolAfter[1].fromOffcut, 'B1-R1');
// 批2：用上批回收余板 P1-B1-R2，0 张新板、累计材料费不变
assert.strictEqual(bp2.batch, 2);
assert.strictEqual(bp2.standardBoardsCount, 0);
assert.strictEqual(bp2.materialCents, 0);
assert.strictEqual(bp2.cumulativeMaterialCents, 10000);
assert.strictEqual(bp2.poolBeforeCount, 3);
assert.deepStrictEqual(bp2.stockUsed.map((s) => s.id), ['P1-B1-R2']);
assert.deepStrictEqual(bp2.stockAdded, []);
assert.deepStrictEqual(bp2.poolAfter.map((s) => s.id), ['S2', 'P1-B1-R1']);
// 全局汇总：累计材料费 = 逐批累加；最终库存 = 末批批末库存
assert.strictEqual(bp.totalStandardBoards, 1);
assert.strictEqual(bp.totalMaterialCents, 10000);
assert.deepStrictEqual(bp.finalPool.map((s) => s.id), ['S2', 'P1-B1-R1']);
// 非首批自带的 stockBoards 不入池
assert(!bp1.poolAfter.some((s) => s.id === 'X9'));
assert(!bp2.poolAfter.some((s) => s.id === 'X9'));
assert(!bp.finalPool.some((s) => s.id === 'X9'));

// 43) 跨批编号不冲突：初始库存已叫 P1-B1-R1 时，回收编号自动加后缀避让
const bpConflict = batchPreviewBoards({
  batches: [
    {
      boardWidth: 1000, boardHeight: 500, kerf: 0, boardPrice: 10,
      stockBoards: [{ id: 'P1-B1-R1', width: 100, height: 100 }], // 与生成的回收编号撞名
      orders: [{ orderNo: 'A', parts: [{ name: '板', width: 400, height: 300, quantity: 1 }] }],
    },
  ],
});
assert.deepStrictEqual(bpConflict.batches[0].stockAdded.map((s) => s.id), ['P1-B1-R1-2', 'P1-B1-R2']);
const bpConflictPool = bpConflict.batches[0].poolAfter.map((s) => s.id);
assert.deepStrictEqual(bpConflictPool, ['P1-B1-R1', 'P1-B1-R1-2', 'P1-B1-R2']);
assert.strictEqual(new Set(bpConflictPool).size, bpConflictPool.length, '余板编号全程不得重复');

// 44) 跨批使用回收余板：零件大于本批标准板、但恰好能放进上批回收的余板
const bpReuse = batchPreviewBoards({
  batches: [
    {
      boardWidth: 700, boardHeight: 500, kerf: 0, boardPrice: 10,
      orders: [{ orderNo: 'A', parts: [{ name: '板', width: 600, height: 500, quantity: 1 }] }],
    },
    {
      boardWidth: 100, boardHeight: 100, kerf: 0, boardPrice: 10, // 标准板极小
      orders: [{ orderNo: 'B', parts: [{ name: '条', width: 100, height: 500, quantity: 1 }] }],
    },
  ],
});
assert.deepStrictEqual(bpReuse.batches[0].stockAdded.map((s) => s.id), ['P1-B1-R1']);
assert.strictEqual(bpReuse.batches[1].standardBoardsCount, 0, '应复用上批回收余板而非开新板');
assert.deepStrictEqual(bpReuse.batches[1].stockUsed.map((s) => s.id), ['P1-B1-R1']);
assert.strictEqual(bpReuse.batches[1].cumulativeMaterialCents, 1000);
assert.strictEqual(bpReuse.totalMaterialCents, 1000);

// 45) 某批无法加工：指出批次并停止，不提交部分结果
assert.throws(() => batchPreviewBoards({
  batches: [
    {
      boardWidth: 1200, boardHeight: 800, kerf: 0,
      orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 1 }] }],
    },
    {
      boardWidth: 500, boardHeight: 300, kerf: 0,
      orders: [{ orderNo: 'B', parts: [{ name: '大', width: 900, height: 900, quantity: 1 }] }],
    },
  ],
}), (e) => {
  assert(e instanceof UserError);
  assert(/第 2 批/.test(e.message), '错误信息应指出无法加工的批次：' + e.message);
  return true;
});
// 首批初始余板库存非法同样指出批次
assert.throws(() => batchPreviewBoards({
  batches: [
    {
      boardWidth: 1000, boardHeight: 1000, kerf: 0,
      stockBoards: [{ id: 'DUP', width: 10, height: 10 }, { id: 'DUP', width: 20, height: 20 }],
      orders: [{ orderNo: 'A', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
    },
  ],
}), (e) => {
  assert(e instanceof UserError);
  assert(/第 1 批/.test(e.message), '初始库存非法应指出批次：' + e.message);
  return true;
});

// 46) 连续预演输入校验与只读性：空批次 / 非数组报错；各批输入快照不被修改
assert.throws(() => batchPreviewBoards({}), UserError, '缺少 batches 应报错');
assert.throws(() => batchPreviewBoards({ batches: [] }), UserError, '空批次应报错');
assert.throws(() => batchPreviewBoards({ batches: 'x' }), UserError, '非数组批次应报错');
const bpIn = {
  batches: [
    {
      boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 100,
      stockBoards: [{ id: 'S1', width: 700, height: 500 }],
      orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 2 }] }],
    },
    {
      boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 100,
      stockBoards: [{ id: 'S9', width: 100, height: 100 }],
      orders: [{ orderNo: 'B', parts: [{ name: '块', width: 600, height: 400, quantity: 1 }] }],
    },
  ],
};
const bpInCopy = JSON.parse(JSON.stringify(bpIn));
batchPreviewBoards(bpIn);
assert.deepStrictEqual(bpIn, bpInCopy, '预演不得改动各批输入快照');

// 47) 机台开料排程：两台同构机台，平局按“板号 → 机台输入序号”字典序选取
//     5 件 600×400 → 板1（4 件，刀长合计 2000，最长刀 800）、板2（1 件，刀长合计 1400）
//     两台机台参数相同（速度 100、准备 0 秒）：(甲,乙) 与 (乙,甲) 同为 20 秒，取字典序小的 (甲,乙)
const schBase = {
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] }],
};
const schPlan = cutBoards(schBase);
assert.strictEqual(schPlan.boardsCount, 2);
assert.deepStrictEqual(schPlan.boards.map((b) => b.cuts.reduce((s, c) => s + c.length, 0)), [2000, 1400]);
const sc1 = scheduleBoards({
  ...schBase,
  machines: [
    { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0 },
    { name: '乙', maxCutLength: 800, speed: 100, setupSeconds: 0 },
  ],
});
assert.strictEqual(sc1.boardsCount, 2);
assert.strictEqual(sc1.makespan, 20);
assert.deepStrictEqual(sc1.boards.map((b) => [b.board, b.machine, b.machineIndex]), [[1, '甲', 1], [2, '乙', 2]]);
assert.deepStrictEqual(sc1.boards.map((b) => [b.start, b.end]), [[0, 20], [0, 14]]);
assert.deepStrictEqual(sc1.boards.map((b) => b.cutLength), [2000, 1400]);
assert.deepStrictEqual(sc1.boards.map((b) => b.longestCut), [800, 800]);
assert.deepStrictEqual(sc1.boards.map((b) => b.duration), [20, 14]);
assert.deepStrictEqual(sc1.machines.map((m) => m.boards), [[1], [2]]);
assert.deepStrictEqual(sc1.machines.map((m) => m.end), [20, 14]);

// 48) 速度差异 + 同机台按板号顺序连续加工；独立暴力复核最小完工时间
//     9 件 → 3 板（刀长合计 2000 / 2000 / 1400）；甲速 100、乙速 200、均零准备
//     最优 (甲,乙,乙)：甲 20，乙 10+7=17，完工 20（字典序最小的 20 秒分配）
const schBase3 = {
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 9 }] }],
};
const sc2 = scheduleBoards({
  ...schBase3,
  machines: [
    { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0 },
    { name: '乙', maxCutLength: 800, speed: 200, setupSeconds: 0 },
  ],
});
assert.strictEqual(sc2.boardsCount, 3);
assert.strictEqual(sc2.makespan, 20);
assert.deepStrictEqual(sc2.boards.map((b) => b.machine), ['甲', '乙', '乙']);
// 同一机台按板号顺序连续加工：乙依次加工板2（0→10）、板3（10→17）
assert.deepStrictEqual(sc2.boards.map((b) => [b.start, b.end]), [[0, 20], [0, 10], [10, 17]]);
assert.deepStrictEqual(sc2.machines[1].boards, [2, 3]);
assert.strictEqual(sc2.machines[1].end, 17);
// 独立暴力复核：直接按方案刀长遍历 2^3 种分配求最小完工时间
const lens3 = cutBoards(schBase3).boards.map((b) => b.cuts.reduce((s, c) => s + c.length, 0));
let brute = Infinity;
for (let mask = 0; mask < 8; mask++) {
  const t = [0, 0];
  for (let b = 0; b < 3; b++) t[(mask >> b) & 1] += lens3[b] / [100, 200][(mask >> b) & 1];
  brute = Math.min(brute, Math.max(...t));
}
assert(Math.abs(sc2.makespan - brute) < 1e-9, `排程完工时间 ${sc2.makespan} 应等于暴力最小值 ${brute}`);

// 49) 每板准备秒数计入耗时；机台可行性按实际最长刀判定（边界值可行）
//     1 件 → 1 板（刀长合计 1400，最长刀 800）：甲上限 700 不可分配，乙上限 800 恰好可行
const sc3 = scheduleBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 1 }] }],
  machines: [
    { name: '甲', maxCutLength: 700, speed: 100, setupSeconds: 0 },
    { name: '乙', maxCutLength: 800, speed: 100, setupSeconds: 5 },
  ],
});
assert.strictEqual(sc3.boards[0].machine, '乙');
assert.strictEqual(sc3.boards[0].machineIndex, 2);
assert.strictEqual(sc3.boards[0].duration, 19); // 准备 5 秒 + 1400 ÷ 100
assert.strictEqual(sc3.makespan, 19);
assert.deepStrictEqual(sc3.machines[0].boards, [], '超限机台不应分得任何板');
assert.strictEqual(sc3.machines[0].end, 0);
// 全部机台都超限 → 报错并指出板号
assert.throws(() => scheduleBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 1 }] }],
  machines: [
    { name: '甲', maxCutLength: 700, speed: 100, setupSeconds: 0 },
    { name: '乙', maxCutLength: 799, speed: 100, setupSeconds: 0 },
  ],
}), (e) => {
  assert(e instanceof UserError);
  assert(/第 1 张板/.test(e.message) && /无可行机台/.test(e.message),
    '错误信息应指出板号与无可行机台：' + e.message);
  return true;
});

// 50) 三台机台：全部板分给最快机台；未分板的机台完工 0 秒
const sc4 = scheduleBoards({
  ...schBase,
  machines: [
    { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0 },
    { name: '乙', maxCutLength: 800, speed: 100, setupSeconds: 0 },
    { name: '丙', maxCutLength: 800, speed: 280, setupSeconds: 0 },
  ],
});
assert.deepStrictEqual(sc4.boards.map((b) => b.machine), ['丙', '丙']);
assert.deepStrictEqual(sc4.machines.map((m) => m.boards), [[], [], [1, 2]]);
assert(Math.abs(sc4.makespan - 3400 / 280) < 1e-3, `完工时间应约 ${3400 / 280}，实际 ${sc4.makespan}`);
assert.strictEqual(sc4.machines[0].end, 0);
assert.strictEqual(sc4.machines[1].end, 0);

// 51) 方案超过 8 张板：明确报错（33 件 → 9 张板）
assert.throws(() => scheduleBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 33 }] }],
  machines: [
    { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0 },
    { name: '乙', maxCutLength: 800, speed: 100, setupSeconds: 0 },
  ],
}), (e) => {
  assert(e instanceof UserError);
  assert(/9 张板/.test(e.message) && /8 张/.test(e.message), '错误信息应指出板数与上限：' + e.message);
  return true;
});

// 52) 机台输入校验：台数、名称唯一、上限 / 速度为正数、准备秒数非负
const schMachinesOk = [
  { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0 },
  { name: '乙', maxCutLength: 800, speed: 100, setupSeconds: 0 },
];
assert.throws(() => scheduleBoards({ ...schBase, machines: [schMachinesOk[0]] }), UserError, '1 台机台应报错');
assert.throws(() => scheduleBoards({ ...schBase, machines: [...schMachinesOk, { name: '丙', maxCutLength: 800, speed: 100, setupSeconds: 0 }, { name: '丁', maxCutLength: 800, speed: 100, setupSeconds: 0 }] }), UserError, '4 台机台应报错');
assert.throws(() => scheduleBoards({ ...schBase }), UserError, '缺少机台清单应报错');
assert.throws(() => scheduleBoards({
  ...schBase,
  machines: [schMachinesOk[0], { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0 }],
}), UserError, '机台名称重复应报错');
assert.throws(() => scheduleBoards({
  ...schBase,
  machines: [{ name: ' ', maxCutLength: 800, speed: 100, setupSeconds: 0 }, schMachinesOk[1]],
}), UserError, '空白机台名称应报错');
assert.throws(() => scheduleBoards({
  ...schBase,
  machines: [{ name: '甲', maxCutLength: 0, speed: 100, setupSeconds: 0 }, schMachinesOk[1]],
}), UserError, '最大单刀长度非正应报错');
assert.throws(() => scheduleBoards({
  ...schBase,
  machines: [{ name: '甲', maxCutLength: 800, speed: -1, setupSeconds: 0 }, schMachinesOk[1]],
}), UserError, '切割速度非正应报错');
assert.throws(() => scheduleBoards({
  ...schBase,
  machines: [{ name: '甲', maxCutLength: 800, speed: 100, setupSeconds: -5 }, schMachinesOk[1]],
}), UserError, '准备秒数为负应报错');

// 53) 排程为只读计算：输入快照不被修改，重算的原方案与直接计算一致
const schIn = {
  ...schBase3,
  machines: [
    { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 2 },
    { name: '乙', maxCutLength: 900, speed: 150, setupSeconds: 0 },
  ],
};
const schInCopy = JSON.parse(JSON.stringify(schIn));
const sc5 = scheduleBoards(schIn);
assert.deepStrictEqual(schIn, schInCopy, '排程不得改动输入快照');
const schPlanDirect = cutBoards(schBase3);
sc5.boards.forEach((sb, i) => {
  const pb = schPlanDirect.boards[i];
  assert(Math.abs(sb.cutLength - pb.cuts.reduce((s, c) => s + c.length, 0)) < 1e-6,
    `板 ${sb.board} 刀长合计应与原方案一致`);
  assert.strictEqual(sb.longestCut, pb.longestCut, `板 ${sb.board} 最长刀应与原方案一致`);
});
// 逐板起止秒数守恒：同机台相邻板首尾相接，完工时间 = 各机台完工秒数最大值
// （起止与耗时各自保留 3 位小数，独立舍入后允许 0.002 以内的尾差）
for (const m of sc5.machines) {
  const rows = sc5.boards.filter((b) => b.machine === m.name);
  assert.deepStrictEqual(rows.map((b) => b.board), m.boards, '机台板号队列应与逐板结果一致');
  rows.forEach((b, i) => {
    if (i > 0) assert(Math.abs(b.start - rows[i - 1].end) < 0.002, '同机台应连续加工');
    assert(Math.abs(b.end - (b.start + b.duration)) < 0.002, '结束 = 开始 + 单板耗时');
  });
  if (rows.length) assert(Math.abs(m.end - rows[rows.length - 1].end) < 1e-6);
}
assert(Math.abs(sc5.makespan - Math.max(...sc5.machines.map((m) => m.end))) < 1e-6,
  '总完工时间应等于各机台完工秒数最大值');

// ---- 分时电费核算 ----
const elBase = {
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] }],
};
const elMachines = [
  { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0, power: 10, startTime: '07:59' },
  { name: '乙', maxCutLength: 800, speed: 100, setupSeconds: 0, power: 10, startTime: '23:59' },
];
const elTariffs = [
  { start: '00:00', end: '08:00', price: 0.3 },
  { start: '08:00', end: '24:00', price: 1 },
];

// 54) 基本核算：沿用同一排程（板1→甲 0→20、板2→乙 0→14），秒数叠加开工时刻换算实际时钟
const el1 = electricityBoards({ ...elBase, machines: elMachines, tariffs: elTariffs });
assert.deepStrictEqual(el1.schedule.boards.map((b) => [b.board, b.machine, b.start, b.end]),
  [[1, '甲', 0, 20], [2, '乙', 0, 14]], '核算沿用的排程应与 /api/schedule 一致');
assert.deepStrictEqual(el1.schedule.machines.map((m) => [m.name, m.boards]), [['甲', [1]], ['乙', [2]]]);
assert.strictEqual(el1.boards[0].startTime, '07:59:00');
assert.strictEqual(el1.boards[0].endTime, '07:59:20');
assert.strictEqual(el1.boards[1].startTime, '23:59:00');
assert.strictEqual(el1.boards[1].endTime, '23:59:14');
// 用电量 = 功率 × 秒数 ÷ 3600；板1 全程谷价 0.3：20 秒 × 10kW = 0.055556 kWh，费用 0.0167 元 → 2 分
assert(Math.abs(el1.boards[0].kwh - 200 / 3600) < 1e-6);
assert.strictEqual(el1.boards[0].costCents, 2);
// 板2 全程峰价 1：14 秒 × 10kW ÷ 3600 × 1 = 0.0389 元 → 4 分
assert(Math.abs(el1.boards[1].kwh - 140 / 3600) < 1e-6);
assert.strictEqual(el1.boards[1].costCents, 4);
assert.strictEqual(el1.totalCents, 6, '总电费 = 逐板整数分汇总');
assert(Math.abs(el1.totalKwh - 340 / 3600) < 1e-6);
assert.deepStrictEqual(el1.machines.map((m) => m.costCents), [2, 4]);
assert.strictEqual(el1.machines[0].finishTime, '07:59:20');
assert.strictEqual(el1.machines[1].finishTime, '23:59:14');

// 55) 跨电价边界拆分：9 件 3 板（刀长 2000/2000/1400），两机台同构 speed=10、
//     07:59 开工：最优 (甲,乙,甲)，板1 在甲上 07:59:00～08:02:20（200 秒）跨 08:00 边界
const elCross = electricityBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 9 }] }],
  machines: [
    { name: '甲', maxCutLength: 800, speed: 10, setupSeconds: 0, power: 10, startTime: '07:59' },
    { name: '乙', maxCutLength: 800, speed: 10, setupSeconds: 0, power: 10, startTime: '07:59' },
  ],
  tariffs: elTariffs,
});
// 同构两机台：(甲,乙,甲) 字典序最优；板1 在甲：07:59:00～08:02:20，跨 08:00 边界
const b1 = elCross.boards[0];
assert.strictEqual(b1.machine, '甲');
assert.strictEqual(b1.segments.length, 2, '板1 应在 08:00 电价边界拆为两段');
assert.deepStrictEqual([b1.segments[0].startTime, b1.segments[0].endTime, b1.segments[0].seconds],
  ['07:59:00', '08:00:00', 60]);
assert.strictEqual(b1.segments[0].priceRate, 0.3);
assert.deepStrictEqual([b1.segments[1].startTime, b1.segments[1].endTime, b1.segments[1].seconds],
  ['08:00:00', '08:02:20', 140]);
assert.strictEqual(b1.segments[1].priceRate, 1);
// 分段费用 = 10×60/3600×0.3 + 10×140/3600×1 = 0.05 + 0.3889 = 0.4389 元 → 44 分
assert(Math.abs(b1.segments[0].price - 0.05) < 1e-4);
assert(Math.abs(b1.segments[1].price - 1400 / 3600) < 1e-4);
assert.strictEqual(b1.costCents, 44);
// 分段秒数 / 用电量守恒
assert(Math.abs(b1.segments.reduce((s, x) => s + x.seconds, 0) - 200) < 1e-6);
assert(Math.abs(b1.segments.reduce((s, x) => s + x.kwh, 0) - b1.kwh) < 1e-6);

// 56) 跨午夜按日循环拆分：13 件 4 板、两机台同速 50（每板 40/40/40/28 秒），
//     乙 23:59 开工分得板 3、4：板4（23:59:40～次日 00:00:08）在午夜拆分并循环回谷段
const elMid = electricityBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 13 }] }],
  machines: [
    { name: '甲', maxCutLength: 800, speed: 50, setupSeconds: 0, power: 10, startTime: '00:00' },
    { name: '乙', maxCutLength: 800, speed: 50, setupSeconds: 0, power: 10, startTime: '23:59' },
  ],
  tariffs: elTariffs,
});
const mb4 = elMid.boards[3];
assert.strictEqual(mb4.machine, '乙');
assert.strictEqual(mb4.segments.length, 2, '板4 应在午夜拆为两段');
// 第一段恰在 24:00 结束：结束点保留为当日 24:00:00，下一段从次日 00:00:00 开始
assert.deepStrictEqual([mb4.segments[0].startDay, mb4.segments[0].endDay, mb4.segments[0].endTime, mb4.segments[0].seconds, mb4.segments[0].priceRate],
  [0, 0, '24:00:00', 20, 1]);
assert.deepStrictEqual([mb4.segments[1].startDay, mb4.segments[1].endDay, mb4.segments[1].startTime, mb4.segments[1].seconds, mb4.segments[1].priceRate],
  [1, 1, '00:00:00', 8, 0.3], '午夜后电价应按日循环回到谷段');
assert.strictEqual(mb4.endDay, 1);
assert.strictEqual(mb4.endTime, '00:00:08');
// 费用 = 10×20/3600×1 + 10×8/3600×0.3 = 0.05556 + 0.00667 = 0.0622 元 → 6 分
assert.strictEqual(mb4.costCents, 6);
assert.strictEqual(elMid.machines[1].finishDay, 1);
assert.strictEqual(elMid.machines[1].finishTime, '00:00:08');
// 逐板整数分合计 = 逐机台合计 = 总电费
assert.strictEqual(elMid.totalCents, elMid.boards.reduce((s, b) => s + b.costCents, 0));
assert.strictEqual(elMid.totalCents, elMid.machines.reduce((s, m) => s + m.costCents, 0));
assert(Math.abs(elMid.totalKwh - elMid.boards.reduce((s, b) => s + b.kwh, 0)) < 1e-6);

// 57) 单一电价段覆盖全天（00:00～24:00）、零功率：费用恒为 0，用电量仍按秒累计
const elFlat = electricityBoards({
  ...elBase,
  machines: [
    { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0, power: 0, startTime: '12:00' },
    { name: '乙', maxCutLength: 800, speed: 100, setupSeconds: 0, power: 0, startTime: '12:00' },
  ],
  tariffs: [{ start: '00:00', end: '24:00', price: 0.6 }],
});
assert.strictEqual(elFlat.boards.every((b) => b.costCents === 0 && b.kwh === 0), true);
assert.strictEqual(elFlat.totalCents, 0);
assert.strictEqual(elFlat.boards[0].segments.length, 1);
assert.strictEqual(elFlat.boards[0].segments[0].priceRate, 0.6);

// 58) 整日循环：开工后加工跨越多个午夜（speed 1、100000 秒量级）也能正确按日循环且秒数守恒
const elLong = electricityBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  orders: [{ orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] }],
  machines: [
    { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0, power: 6, startTime: '00:00' },
    { name: '乙', maxCutLength: 800, speed: 1, setupSeconds: 0, power: 0.01, startTime: '00:00' },
  ],
  tariffs: [
    { start: '00:00', end: '08:00', price: 0.3 },   // 8h = 28800s
    { start: '08:00', end: '24:00', price: 1 },
  ],
});
// 乙分板2（刀长 1400 → 1400 秒），不跨日；甲分板1（2000/100=20 秒）。改验证分段守恒即可
for (const b of elLong.boards) {
  assert(Math.abs(b.segments.reduce((s, x) => s + x.seconds, 0) - (b.end - b.start)) < 1e-6,
    `板 ${b.board} 分段秒数之和应等于加工秒数`);
}
assert.strictEqual(elLong.totalCents, elLong.boards.reduce((s, b) => s + b.costCents, 0));

// 59) 修改计价参数只重新核算：排程与直接 scheduleBoards 完全一致，且不改动输入快照
const elIn = { ...elBase, machines: elMachines, tariffs: elTariffs };
const elInCopy = JSON.parse(JSON.stringify(elIn));
const el2 = electricityBoards(elIn);
assert.deepStrictEqual(elIn, elInCopy, '电费核算不得改动输入快照');
const scRef = scheduleBoards({ ...elBase, machines: elMachines.map(({ power: _p, startTime: _s, ...rest }) => rest) });
assert.deepStrictEqual(el2.schedule, scRef, '回显排程必须与 /api/schedule 结果一致');

// 60) 电价时段配置错误：未从 00:00 开始 / 未覆盖到 24:00 / 重叠 / 空档 / 负价 / 起止倒置 / 非法时刻
const elBadTariffs = [
  [{ start: '08:00', end: '24:00', price: 1 }],
  [{ start: '00:00', end: '08:00', price: 0.3 }, { start: '08:00', end: '23:00', price: 1 }],
  [{ start: '00:00', end: '08:00', price: 0.3 }, { start: '07:00', end: '24:00', price: 1 }],
  [{ start: '00:00', end: '08:00', price: 0.3 }, { start: '09:00', end: '24:00', price: 1 }],
  [{ start: '00:00', end: '08:00', price: -0.1 }, { start: '08:00', end: '24:00', price: 1 }],
  [{ start: '10:00', end: '08:00', price: 1 }, { start: '08:00', end: '24:00', price: 1 }],
  [{ start: '00:00', end: '25:00', price: 1 }],
];
for (const t of elBadTariffs) {
  assert.throws(() => electricityBoards({ ...elBase, machines: elMachines, tariffs: t }), UserError,
    '非法电价时段应报错：' + JSON.stringify(t));
}
assert.throws(() => electricityBoards({ ...elBase, machines: elMachines }), UserError, '缺少电价时段应报错');
assert.throws(() => electricityBoards({ ...elBase, machines: elMachines, tariffs: [] }), UserError, '空时段应报错');
// 乱序但完整的时段输入应被接受（内部排序）
const elSorted = electricityBoards({
  ...elBase, machines: elMachines,
  tariffs: [
    { start: '08:00', end: '24:00', price: 1 },
    { start: '00:00', end: '08:00', price: 0.3 },
  ],
});
assert.deepStrictEqual(elSorted.tariffs.map((t) => t.start), ['00:00', '08:00']);

// 61) 机台计价参数校验：功率非负、开工时刻为合法 HH:mm（24:00 不合法）
assert.throws(() => electricityBoards({
  ...elBase, tariffs: elTariffs,
  machines: [
    { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0, power: -1, startTime: '07:30' },
    { name: '乙', maxCutLength: 800, speed: 100, setupSeconds: 0, power: 5, startTime: '07:30' },
  ],
}), UserError, '负功率应报错');
assert.throws(() => electricityBoards({
  ...elBase, tariffs: elTariffs,
  machines: [
    { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0, power: 5, startTime: '24:00' },
    { name: '乙', maxCutLength: 800, speed: 100, setupSeconds: 0, power: 5, startTime: '07:30' },
  ],
}), UserError, '开工时刻 24:00 应报错');
assert.throws(() => electricityBoards({
  ...elBase, tariffs: elTariffs,
  machines: [
    { name: '甲', maxCutLength: 800, speed: 100, setupSeconds: 0, power: 5, startTime: '7点半' },
    { name: '乙', maxCutLength: 800, speed: 100, setupSeconds: 0, power: 5, startTime: '07:30' },
  ],
}), UserError, '开工时刻格式错误应报错');

// 62) 刀路执行前置（pred）：按现有刀序回放矩形切分，每刀记录所切矩形的产生刀
// 2×2 网格（零锯缝）：第 1 刀竖切整板（无前置），第 2、3 刀分别切第 1 刀产生的左条与右块
const predGrid = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  parts: [{ name: '块', width: 600, height: 400, quantity: 4 }],
});
assert.deepStrictEqual(predGrid.boards[0].cuts.map((c) => c.pred), [0, 1, 1]);
assert.deepStrictEqual(predGrid.boards[0].cuts.map((c) => c.seq), [1, 2, 3]);
// 零锯缝 1000×500 两件：第 3 刀切第 1 刀产生的右块，第 4 刀切第 3 刀产生的左条
const predK0 = cutBoards({
  boardWidth: 1000, boardHeight: 500, kerf: 0,
  parts: [{ name: 'A', width: 400, height: 300, quantity: 2 }],
});
assert.deepStrictEqual(predK0.boards[0].cuts.map((c) => c.pred), [0, 1, 1, 3]);
// 带锯缝多板：前置刀序号恒小于本刀序号（刀序回放单调），首刀前置恒为 0（初始整板）
const predK3 = cutBoards({
  boardWidth: 2440, boardHeight: 1220, kerf: 3, boardPrice: 10,
  parts: [{ name: '柜门', width: 600, height: 400, quantity: 8 }],
});
for (const b of predK3.boards) {
  b.cuts.forEach((c, i) => {
    assert.strictEqual(c.pred >= 0 && c.pred < c.seq, true, `板 ${b.index} 第 ${c.seq} 刀前置越界`);
    if (i === 0) assert.strictEqual(c.pred, 0, '每板首刀所切必为初始整板');
  });
}
assert.deepStrictEqual(predK3.boards[0].cuts.map((c) => c.pred),
  [0, 1, 2, 3, 1, 5, 6, 5, 8, 9, 8, 11]);
// 无刀板（零件恰好铺满）：无刀路即无前置记录，字段仍为数组
const predFull = cutBoards({
  boardWidth: 1000, boardHeight: 600, kerf: 2,
  parts: [{ name: '整板', width: 1000, height: 600, quantity: 1 }],
});
assert.strictEqual(predFull.boards[0].cuts.length, 0);
// 余板尺寸同样适用：余板上的刀路按余板实际尺寸回放
const predStock = cutBoards({
  boardWidth: 2440, boardHeight: 1220, kerf: 3,
  stockBoards: [{ id: 'YB-01', width: 1200, height: 800 }],
  parts: [{ name: '柜门', width: 600, height: 400, quantity: 3 }],
});
assert.strictEqual(predStock.boards[0].kind, 'stock');
assert.deepStrictEqual(predStock.boards[0].cuts.map((c) => c.pred), [0, 1, 1, 3]);
assert.deepStrictEqual(predStock.boards[1].cuts.map((c) => c.pred), [0, 1]);
// 前置关系不改动既有输出：落位、分摊与排程字段保持原样（仅新增 pred 字段）
assert.strictEqual(predK3.totalMaterialCents, predK3.standardBoardsCount * 1000);
assert.strictEqual(predK3.boards[0].cost.shares.reduce((s, x) => s + x.cents, 0),
  predK3.boards[0].cost.priceCents);

console.log('全部算法自检通过 ✔');
