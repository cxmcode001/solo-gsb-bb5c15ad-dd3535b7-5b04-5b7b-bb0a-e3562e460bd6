import React, { useCallback, useMemo, useState } from 'react';

/**
 * 刀路执行记录（仅存当前页面，绑定生成方案）
 *
 * 规则：
 *  - 每刀的直接前置为后端按未舍入几何回放矩形切分得到的 cuts[].pre
 *    （初始整板无前置 → null）；仅当前置刀已完成时才可标记该刀完成；
 *  - 不同分支可交错执行；重复标记不计数（只提示，不改变完成刀数）；
 *    越序操作给出缺少的前置刀提示；
 *  - 撤销一刀时同时撤销其所有已完成的后继刀（沿前置关系闭包），其他分支状态保留；
 *  - 状态：done 已完成 / ready 前置均完成、可执行 / blocked 前置未完成。
 */

// 构建板内前置关系：children[pre] = [直接后继刀序…]
export function buildCutGraph(cuts) {
  const children = new Map();
  for (const c of cuts) {
    if (c.pre == null) continue;
    if (!children.has(c.pre)) children.set(c.pre, []);
    children.get(c.pre).push(c.seq);
  }
  return children;
}

// 一刀的执行状态：done / ready / blocked
export function cutStatus(cut, doneSet) {
  if (doneSet.has(cut.seq)) return 'done';
  if (cut.pre == null || doneSet.has(cut.pre)) return 'ready';
  return 'blocked';
}

// 撤销目标刀时需要一并撤销的已完成刀：目标自身 + 全部已完成的后继（传递闭包）
export function undoClosure(seq, children, doneSet) {
  const result = new Set();
  const stack = [seq];
  while (stack.length) {
    const s = stack.pop();
    if (result.has(s)) continue;
    if (!doneSet.has(s)) continue;
    result.add(s);
    for (const ch of children.get(s) || []) stack.push(ch);
  }
  return result;
}

/**
 * 逐板刀路执行状态 hook（状态按板分别保存；hook 所在组件以方案 id 为 key，
 * 重新生成方案时组件重挂载、记录全部清空）。
 * boards：当前方案的板（每板 cuts[].pre 为直接前置刀序）。
 */
export function useCutExecution(boards) {
  const boardKey = useMemo(() => boards.map((b) => b.index).join(','), [boards]);
  // key = `${boardKey}#${boardIndex}` → 该板已完成刀序 Set
  const [doneMap, setDoneMap] = useState(() => new Map());
  // 每板的瞬时提示（越序 / 重复标记 / 撤销级联说明等）
  const [msgMap, setMsgMap] = useState(() => new Map());

  const keyOf = (boardIndex) => `${boardKey}#${boardIndex}`;
  const doneOf = (boardIndex) => doneMap.get(keyOf(boardIndex)) || new Set();

  const updateDone = (boardIndex, updater) => {
    setDoneMap((prev) => {
      const k = keyOf(boardIndex);
      const next = updater(prev.get(k) || new Set());
      const copy = new Map(prev);
      copy.set(k, next);
      return copy;
    });
  };

  const flash = useCallback((boardIndex, text) => {
    setMsgMap((prev) => {
      const copy = new Map(prev);
      copy.set(keyOf(boardIndex), { text, ts: Date.now() });
      return copy;
    });
  }, [boardKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusOf = useCallback((boardIndex, cut) => cutStatus(cut, doneOf(boardIndex)),
    [doneMap, boardKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const completedCount = useCallback((boardIndex) => {
    const b = boards.find((x) => x.index === boardIndex);
    return b ? b.cuts.filter((c) => doneOf(boardIndex).has(c.seq)).length : 0;
  }, [boards, doneMap, boardKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 标记完成：仅前置已完成时生效；重复标记不计数；越序给出缺少的前置刀
  const markDone = useCallback((boardIndex, seq) => {
    const board = boards.find((x) => x.index === boardIndex);
    if (!board) return;
    const cut = board.cuts.find((c) => c.seq === seq);
    if (!cut) return;
    const done = doneOf(boardIndex);
    if (done.has(seq)) {
      flash(boardIndex, { kind: 'info', text: `第 ${seq} 刀已标记完成，重复标记不计数` });
      return;
    }
    if (cut.pre != null && !done.has(cut.pre)) {
      flash(boardIndex, {
        kind: 'warn',
        text: `不能标记第 ${seq} 刀：缺少前置刀第 ${cut.pre} 刀，请先完成第 ${cut.pre} 刀`,
      });
      return;
    }
    const willDone = done.size + 1;
    updateDone(boardIndex, (cur) => new Set(cur).add(seq));
    flash(boardIndex, willDone >= board.cuts.length
      ? { kind: 'ok', text: `第 ${seq} 刀已完成：本板全部 ${board.cuts.length} 刀均已完成` }
      : { kind: 'ok', text: `第 ${seq} 刀已标记完成（已完成 ${willDone} / ${board.cuts.length} 刀）` });
  }, [boards, doneMap, boardKey, flash]); // eslint-disable-line react-hooks/exhaustive-deps

  // 撤销：同时撤销该刀已完成的所有后继刀，其他分支 / 其他板状态保留
  const undoCut = useCallback((boardIndex, seq) => {
    const board = boards.find((x) => x.index === boardIndex);
    if (!board) return;
    const done = doneOf(boardIndex);
    if (!done.has(seq)) {
      flash(boardIndex, { kind: 'info', text: `第 ${seq} 刀尚未完成，无需撤销` });
      return;
    }
    const closure = undoClosure(seq, buildCutGraph(board.cuts), done);
    updateDone(boardIndex, (cur) => {
      const next = new Set(cur);
      for (const s of closure) next.delete(s);
      return next;
    });
    const extras = [...closure].filter((s) => s !== seq).sort((a, b) => a - b);
    flash(boardIndex, extras.length > 0
      ? { kind: 'warn', text: `已撤销第 ${seq} 刀，并连带撤销其 ${extras.length} 把已完成后继刀（第 ${extras.join('、')} 刀）；其他分支状态保留` }
      : { kind: 'info', text: `已撤销第 ${seq} 刀（无已完成后继刀），其他分支状态保留` });
  }, [boards, doneMap, boardKey, flash]); // eslint-disable-line react-hooks/exhaustive-deps

  const messageFor = (boardIndex) => msgMap.get(keyOf(boardIndex)) || null;

  return { doneOf, statusOf, completedCount, markDone, undoCut, messageFor };
}

/**
 * 逐板刀路执行记录面板（放在逐板裁切图旁）。
 * exec：useCutExecution 返回的操作集合。
 */
export default function CutExecutionPanel({ board, exec }) {
  const { doneOf, statusOf, completedCount, markDone, undoCut, messageFor } = exec;
  const children = useMemo(() => buildCutGraph(board.cuts), [board.cuts]);
  const done = doneOf(board.index);
  const doneCount = completedCount(board.index);
  const total = board.cuts.length;
  const allDone = total > 0 && doneCount >= total;
  const message = messageFor(board.index);

  if (total === 0) {
    return (
      <aside className="cut-exec-panel" aria-label={`第 ${board.index} 板刀路执行记录`}>
        <h4 className="cut-exec-title">刀路执行记录</h4>
        <p className="cut-exec-empty">本板零件恰好铺满，无刀可执行。</p>
      </aside>
    );
  }

  return (
    <aside className="cut-exec-panel" aria-label={`第 ${board.index} 板刀路执行记录`}>
      <h4 className="cut-exec-title">
        刀路执行记录
        <span className={`cut-progress ${allDone ? 'all-done' : ''}`}>
          完成 {doneCount} / {total} 刀
        </span>
      </h4>
      <div className="cut-exec-legend">
        <span><i className="ce-dot done" />已完成</span>
        <span><i className="ce-dot ready" />可执行</span>
        <span><i className="ce-dot blocked" />被阻塞</span>
      </div>
      <ol className="cut-exec-list">
        {board.cuts.map((c) => {
          const st = statusOf(board.index, c);
          const kids = children.get(c.seq) || [];
          return (
            <li key={c.seq} className={`cut-exec-row ${st}`}>
              <span className="ce-seq" title={`第 ${c.seq} 刀`}>{c.seq}</span>
              <span className="ce-type">{c.type === 'v' ? '竖切' : '横切'}</span>
              <span className="ce-pre">
                {c.pre == null ? '初始整板' : <>前置 <b>第 {c.pre} 刀</b></>}
                {kids.length > 0 && (
                  <span className="ce-kids" title="该刀的直接后继刀">→ 后继 {kids.join('、')} 刀</span>
                )}
              </span>
              <span className="ce-actions">
                {st === 'done' ? (
                  <button
                    type="button"
                    className="btn ce-btn undo"
                    onClick={() => undoCut(board.index, c.seq)}
                    title="撤销该刀；其已完成的后继刀会被一并撤销，其他分支状态保留"
                  >
                    撤销
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`btn ce-btn ${st === 'blocked' ? 'blocked' : 'ready'}`}
                    onClick={() => markDone(board.index, c.seq)}
                    title={st === 'blocked' ? `前置第 ${c.pre} 刀未完成` : '标记该刀完成'}
                  >
                    {st === 'blocked' ? '阻塞' : '标记完成'}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {message && (
        <p className={`cut-exec-msg ${message.kind}`} role="status">
          {message.text}
        </p>
      )}
      <p className="cut-exec-hint">
        仅当前置刀完成后才能标记该刀；不同分支可交错执行；重复标记不计数；
        撤销会连带撤销其已完成的后继刀。
      </p>
    </aside>
  );
}
