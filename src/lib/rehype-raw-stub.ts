/**
 * rehype-raw 的替身。
 *
 * 莲花从不渲染模型输出的原始 HTML：`Chat.tsx` 把 `raw` 从 Streamdown 的
 * `defaultRehypePlugins` 里剔除，Streamdown 随即改走「html 节点当纯文本显示」的分支。
 * 但 Streamdown 对 rehype-raw 是顶层静态 import，打包器无法摇掉，于是整个 parse5
 * HTML 解析器（约 269 kB 源码）仍会进首屏分包。
 *
 * Streamdown 对这个导入的唯一用途是恒等比较——判断调用方有没有主动传入 rehype-raw
 * （`plugins.some(p => p === rawPlugin)`）。因此一个不做任何事的唯一函数就够用：
 * 比较照常为 false，真实的 HTML 解析器不再被打包。
 *
 * 若将来确实需要渲染原始 HTML，请删掉 vite.config.ts 里的这条 alias 并恢复默认插件，
 * 同时重新评估「让模型输出的 HTML 进入 DOM」的安全边界。
 */
export default function rehypeRawStub() {
  return undefined;
}
