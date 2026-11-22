import React from "react";
import { AlertTriangle, Copy, RefreshCw } from "lucide-react";
import { logError } from "../lib/logger";

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  errorStack: string;
  copied: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: "",
      errorStack: "",
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error.message || "页面渲染发生异常",
      errorStack: error.stack || "",
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logError(
      "react.render",
      error.message || "React render error",
      [error.stack, info.componentStack].filter(Boolean).join("\n")
    );
  }

  handleCopy = async () => {
    const text = `${this.state.errorMessage}\n\n${this.state.errorStack}`;
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 1800);
    } catch {
      // ignore
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="w-full max-w-lg rounded-2xl bg-card p-6 shadow-popover-soft space-y-4">
            <div className="flex items-center gap-2.5 text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <h2 className="text-sm font-semibold">
                界面遇到意外错误（已自动写入错误日志）
              </h2>
            </div>

            <div className="max-h-48 overflow-y-auto rounded-xl bg-muted/60 p-3 font-mono text-[11px] leading-relaxed text-foreground/85 select-text">
              <div className="font-semibold text-destructive">
                {this.state.errorMessage}
              </div>
              {this.state.errorStack && (
                <pre className="mt-2 whitespace-pre-wrap text-[10px] text-muted-foreground">
                  {this.state.errorStack}
                </pre>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={this.handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-accent"
              >
                <Copy className="h-3.5 w-3.5" />
                {this.state.copied ? "已复制" : "复制错误信息"}
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重新加载
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
