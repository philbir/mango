import * as monaco from "monaco-editor";
import { useEffect, useId, useRef } from "react";
import {
  type MongoCompletionConfig,
  clearModelMongoConfig,
  ensureMongoCompletionRegistered,
  setModelMongoConfig,
} from "../monaco-mongo";
import { useSettings } from "../settings";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  showLineNumbers?: boolean;
  wordWrap?: boolean;
  readOnly?: boolean;
  completion?: MongoCompletionConfig;
  onSubmit?: () => void;
}

export const MonacoJsonInput = ({
  value,
  onChange,
  minHeight = "44px",
  showLineNumbers = false,
  wordWrap = true,
  readOnly = false,
  completion,
  onSubmit,
}: Props) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const { theme } = useSettings();
  const idHint = useId();

  useEffect(() => {
    if (!hostRef.current) return;
    ensureMongoCompletionRegistered();

    const safeId = idHint.replace(/[^a-zA-Z0-9]/g, "-");
    const uri = monaco.Uri.parse(`inmemory://mongo-manager/${safeId}.json`);
    const existing = monaco.editor.getModel(uri);
    const model =
      existing ??
      monaco.editor.createModel(value, "json", uri);

    if (existing && existing.getValue() !== value) {
      existing.setValue(value);
    }

    const editor = monaco.editor.create(hostRef.current, {
      model,
      theme: theme === "dark" ? "vs-dark" : "vs",
      lineNumbers: showLineNumbers ? "on" : "off",
      lineDecorationsWidth: showLineNumbers ? 10 : 0,
      lineNumbersMinChars: showLineNumbers ? 3 : 0,
      glyphMargin: false,
      folding: showLineNumbers,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: wordWrap ? "on" : "off",
      fontFamily:
        "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12.5,
      tabSize: 2,
      insertSpaces: true,
      automaticLayout: true,
      contextmenu: false,
      readOnly,
      padding: { top: 6, bottom: 6 },
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
        useShadows: false,
      },
      renderLineHighlight: showLineNumbers ? "line" : "none",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "on",
      formatOnPaste: true,
      formatOnType: true,
    });

    editorRef.current = editor;

    const sub = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });

    const submitDisposable = editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => onSubmitRef.current?.(),
    );

    return () => {
      sub.dispose();
      // addCommand returns a disposable id (string|null), nothing to dispose explicitly
      void submitDisposable;
      editor.dispose();
      // Only dispose models we created
      if (!existing) model.dispose();
      clearModelMongoConfig(uri);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    setModelMongoConfig(model.uri, completion ?? {});
  }, [completion]);

  return (
    <div
      ref={hostRef}
      style={{ minHeight }}
      className="h-full w-full"
    />
  );
};
