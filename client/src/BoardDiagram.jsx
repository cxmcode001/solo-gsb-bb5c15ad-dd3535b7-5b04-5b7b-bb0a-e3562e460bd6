import React from 'react';

const PART_COLORS = [
  '#bfdbfe', '#bbf7d0', '#fde68a', '#fecaca', '#ddd6fe',
  '#a5f3fc', '#fed7aa', '#fbcfe8', '#d9f99d', '#c7d2fe',
  '#a7f3d0', '#f5d0fe', '#bae6fd', '#fef08a', '#fecdd3',
];

// 颜色键：多订单拼版时同订单同名零件同色，不同订单的同名零件异色
export function partColor(name, order) {
  const key = order ? `${order}⟂${name}` : name;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PART_COLORS[h % PART_COLORS.length];
}

const PAD = 14;

/**
 * 单板裁切图示：
 *  - 米黄色底 = 余料；彩色块 = 零件（左上角小字标注订单号）；灰色锯缝带 + 虚线刀刃 = 每一刀
 *  - 圆形编号标注下刀次序（贯穿当前矩形区域）
 *  - 可选 cutStatus（{ 刀序: 'done' | 'ready' | 'blocked' }，来自刀路执行记录）：
 *    刀刃线与刀序徽章按执行状态着色（已完成 / 可执行 / 被阻塞），未传时保持默认配色
 */
export default function BoardDiagram({ board, boardWidth, boardHeight, cutStatus }) {
  const maxW = 620;
  const maxH = 520;
  const sx = maxW / boardWidth;
  const sy = maxH / boardHeight;
  const scale = Math.min(sx, sy);
  const vbW = boardWidth * scale + PAD * 2;
  const vbH = boardHeight * scale + PAD * 2;

  const px = (v) => PAD + v * scale;

  const labelText = (p) => {
    const id = `#${p.index}`;
    const dims = `${strip(p.w)}×${strip(p.h)}${p.rotated ? ' 旋转' : ''}`;
    return { id, dims };
  };

  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${vbW.toFixed(1)} ${vbH.toFixed(1)}`}
      role="img"
      aria-label={`第 ${board.index} 板裁切图`}
    >
      {/* 余料底色（整张原板） */}
      <rect
        x={px(0)}
        y={px(0)}
        width={boardWidth * scale}
        height={boardHeight * scale}
        className="remainder-bg"
      />

      {/* 零件 */}
      {board.placements.map((p, i) => {
        const { id, dims } = labelText(p);
        const w = p.w * scale;
        const h = p.h * scale;
        const showMain = w > 56 && h > 26;
        const showDims = w > 56 && h > 42;
        const showOrder = p.order && w > 40 && h > 18;
        const orderTag = p.order && p.order.length > 10 ? p.order.slice(0, 10) + '…' : p.order;
        return (
          <g key={`p-${i}`}>
            <rect
              x={px(p.x)}
              y={px(p.y)}
              width={w}
              height={h}
              fill={partColor(p.part, p.order)}
              stroke="#334155"
              strokeWidth={1.2}
            >
              <title>{`订单「${p.order || ''}」${p.part} ${id}：${dims}，位置 (${strip(p.x)}, ${strip(p.y)})`}</title>
            </rect>
            {showOrder && (
              <text x={px(p.x) + 4} y={px(p.y) + 11} className="part-order">
                {orderTag}
              </text>
            )}
            {showMain && (
              <text x={px(p.x) + w / 2} y={px(p.y) + h / 2 - (showDims ? 4 : 0)} className="part-label">
                {p.part.length > 8 ? p.part.slice(0, 8) + '…' : p.part} {id}
              </text>
            )}
            {showDims && (
              <text x={px(p.x) + w / 2} y={px(p.y) + h / 2 + 12} className="part-dims">
                {dims}
              </text>
            )}
          </g>
        );
      })}

      {/* 锯缝带与刀刃线、刀序编号（按刀路执行状态着色） */}
      {board.cuts.map((c) => {
        const b = c.band;
        const cx = px((b.x + b.w / 2));
        const cy = px((b.y + b.h / 2));
        const badgeR = 9;
        // 锯缝宽度为 0（理想切割）时只画刀刃线；非零缝带至少渲染 1px 宽
        const showBand = c.type === 'v' ? b.w > 0 : b.h > 0;
        const execCls = cutStatus && cutStatus[c.seq] ? ` ${cutStatus[c.seq]}` : '';
        const execLabel = { done: '已完成', ready: '可执行', blocked: '被阻塞' }[cutStatus?.[c.seq]];
        return (
          <g key={`c-${c.seq}`}>
            {showBand && (
              <rect
                x={px(b.x)}
                y={px(b.y)}
                width={Math.max(b.w * scale, 1)}
                height={Math.max(b.h * scale, 1)}
                className={`kerf-band${execCls}`}
              />
            )}
            <line
              x1={px(c.x1)}
              y1={px(c.y1)}
              x2={px(c.x2)}
              y2={px(c.y2)}
              className={`kerf-line${execCls}`}
              strokeDasharray="5 4"
            />
            <g className={`cut-badge${execCls}`}>
              <circle cx={cx} cy={cy} r={badgeR} />
              <text x={cx} y={cy + 0.5}>{c.seq}</text>
              <title>{`第 ${c.seq} 刀（${c.type === 'v' ? '竖切' : '横切'}），贯穿长度 ${strip(c.length)}` +
                (c.pred > 0 ? `，前置：第 ${c.pred} 刀` : '，前置：整板') +
                (execLabel ? `，${execLabel}` : '')}</title>
            </g>
          </g>
        );
      })}

      {/* 板边框 */}
      <rect
        x={px(0)}
        y={px(0)}
        width={boardWidth * scale}
        height={boardHeight * scale}
        className="board-border"
      />
    </svg>
  );
}

function strip(n) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}
