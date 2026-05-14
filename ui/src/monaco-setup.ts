import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

const env: monaco.Environment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === "json") return new JsonWorker() as Worker;
    return new EditorWorker() as Worker;
  },
};

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = env;

if (typeof window !== "undefined") {
  (window as unknown as { monaco: typeof monaco }).monaco = monaco;
}
