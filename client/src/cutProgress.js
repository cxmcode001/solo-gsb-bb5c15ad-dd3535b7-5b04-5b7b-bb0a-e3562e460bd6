/**
 * 刀路执行记录（纯函数，页面本地状态）。
 *
 * 数据约定：
 *  - cuts：方案中某张板的刀路数组（boards[].cuts），每刀含 seq（刀序，从 1 起）
 *    与 pred（直接前置刀序，0 表示所切的是初始整板、无前置）；
 *  - done：Set(已完成刀序)，始终满足“前置闭合”——某刀已完成则其前置链全部已完成
 *    （由 markCut / undoCut 保证）。
 *
 * 规则：
 *  - 仅当直接前置已完成（或无前置）时才可标记该刀完成；不同分支可交错执行；
 *  - 重复标记不计数（返回原状态与 repeated 标记）；
 *  - 越序标记返回 missing（缺少的前置刀序），由界面提示；
 *  - 撤销一刀时同时撤销其已完成的所有后继刀（传递闭包），保留其他分支状态。
 */

/** 每刀状态：done 已完成 / ready 可执行 / blocked 被阻塞。返回 { [seq]: 状态 }。 */
export function cutStatus(cuts, done) {
  const status = {};
  for (const c of cuts) {
    if (done.has(c.seq)) status[c.seq] = 'done';
    else if (c.pred === 0 || done.has(c.pred)) status[c.seq] = 'ready';
    else status[c.seq] = 'blocked';
  }
  return status;
}

/**
 * 标记完成。返回 { done, repeated?, missing? }：
 *  - repeated=true：该刀已完成，重复标记不计数，状态不变；
 *  - missing=N：越序操作，缺少的前置刀序为 N，状态不变；
 *  - 否则返回加入该刀后的新完成集。
 */
export function markCut(cuts, done, seq) {
  if (done.has(seq)) return { done, repeated: true };
  const cut = cuts.find((c) => c.seq === seq);
  if (!cut) return { done, missing: 0 };
  if (cut.pred > 0 && !done.has(cut.pred)) {
    return { done, missing: cut.pred };
  }
  const next = new Set(done);
  next.add(seq);
  return { done: next };
}

/**
 * 撤销一刀：同时撤销其已完成的所有后继刀（沿前置关系向下传递），
 * 其他分支的完成状态保持不变。该刀未完成时状态不变。
 */
export function undoCut(cuts, done, seq) {
  if (!done.has(seq)) return done;
  // 后继关系：前置刀序 -> 直接后继刀序列表
  const children = new Map();
  for (const c of cuts) {
    if (c.pred > 0) {
      if (!children.has(c.pred)) children.set(c.pred, []);
      children.get(c.pred).push(c.seq);
    }
  }
  // 收集该刀的全部后继（传递闭包），连同该刀一起从完成集中移除
  const remove = new Set([seq]);
  const stack = [seq];
  while (stack.length) {
    const cur = stack.pop();
    for (const child of children.get(cur) || []) {
      if (!remove.has(child)) {
        remove.add(child);
        stack.push(child);
      }
    }
  }
  const next = new Set();
  for (const s of done) {
    if (!remove.has(s)) next.add(s);
  }
  return next;
}
