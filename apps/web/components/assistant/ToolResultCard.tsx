interface Props {
  toolName: string;
  output: unknown;
}

function formatOutput(output: unknown): string {
  if (output === null || output === undefined) return "No result";
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

/**
 * Renders a structured tool call result for non-create_event tools.
 */
export function ToolResultCard({ toolName, output }: Props) {
  return (
    <div className="rounded-md border border-slate-700 bg-slate-800/60 p-3 text-sm">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
        {toolName.replace(/_/g, " ")}
      </p>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-300">
        {formatOutput(output)}
      </pre>
    </div>
  );
}
