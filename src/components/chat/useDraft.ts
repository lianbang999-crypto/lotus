import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "lotus:draft:";
const MAX = 20000;
const storage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

/**
 * 输入草稿按账号存进 sessionStorage：刷新或误关标签页不丢字，关闭浏览器即清空，
 * 不会把未发送的心事长期留在这台设备上。
 */
export function useDraft(accountId: string) {
  const key = PREFIX + accountId;
  const read = useCallback(() => storage()?.getItem(key) ?? "", [key]);
  const [initial] = useState(read);
  const timer = useRef<number | null>(null);
  const save = useCallback(
    (text: string) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const store = storage();
        if (!store) return;
        if (text.trim()) store.setItem(key, text.slice(0, MAX));
        else store.removeItem(key);
      }, 250);
    },
    [key],
  );
  const clear = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    storage()?.removeItem(key);
  }, [key]);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return { initial, save, clear, read };
}
