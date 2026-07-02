// desktop/src/renderer/lib/monacoSetup.ts
// Monaco worker 装配:diff 计算只需 editor.worker 一个;不引语言 worker(语法高亮
// 走内置 basic-languages tokenizer,主线程跑)。副作用模块,DiffView 动态 import。
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}
