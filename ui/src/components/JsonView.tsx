import JsonView from "@uiw/react-json-view";
import { darkTheme } from "@uiw/react-json-view/dark";
import { lightTheme } from "@uiw/react-json-view/light";
import { useSettings } from "../settings";

interface Props {
  value: unknown;
  collapsed?: number | boolean;
  className?: string;
}

export const InteractiveJsonView = ({ value, collapsed = 2, className }: Props) => {
  const { theme } = useSettings();
  return (
    <div className={className}>
      <JsonView
        value={value as object}
        collapsed={collapsed}
        displayDataTypes={false}
        displayObjectSize={true}
        enableClipboard={true}
        style={theme === "dark" ? darkTheme : lightTheme}
      />
    </div>
  );
};
