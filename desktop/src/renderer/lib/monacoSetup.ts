// desktop/src/renderer/lib/monacoSetup.ts
// Monaco worker 装配:DiffView 只读 diff 编辑器,只需 editor.worker(语法着色走
// 内置 basic-languages tokenizer,主线程跑)。不引入语言 worker(ts/css/html/json),
// 避免构建产物包含 12MB+ 的 ts.worker 等冗余元文件。
//
// runtime 用 editor.api.js(零语言贡献),types 用 monaco-editor 主入口。
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// 声明全局 MonacoEnvironment
declare global {
  interface Window {
    MonacoEnvironment?: { getWorker: () => Worker }
  }
}

self.MonacoEnvironment = {
  // 所有语言统一用 editor.worker,不加载 ts/css/html/json 语言 worker
  getWorker: () => new EditorWorker(),
}
