import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  tabLabel?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { error, componentStack } = this.state;
    const isDev = (import.meta as any).env?.DEV ?? false;

    return (
      <div className="h-full flex items-center justify-center bg-zinc-900 p-8">
        <div className="max-w-lg w-full space-y-3">
          <div className="flex items-center gap-2 text-red-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="text-sm font-medium">
              {this.props.tabLabel ? `${this.props.tabLabel} crashed` : 'This tab crashed'}
            </span>
          </div>

          {isDev && (
            <>
              <div className="bg-red-950/30 border border-red-900/50 rounded-md p-3">
                <p className="text-xs font-mono text-red-300 break-all">{error.message}</p>
              </div>
              {componentStack && (
                <details className="text-xs">
                  <summary className="text-zinc-500 cursor-pointer hover:text-zinc-300">Component stack</summary>
                  <pre className="mt-1.5 p-2 bg-zinc-800 rounded text-zinc-400 overflow-auto max-h-48 text-[11px] leading-relaxed">
                    {componentStack}
                  </pre>
                </details>
              )}
              {error.stack && (
                <details className="text-xs">
                  <summary className="text-zinc-500 cursor-pointer hover:text-zinc-300">Error stack</summary>
                  <pre className="mt-1.5 p-2 bg-zinc-800 rounded text-zinc-400 overflow-auto max-h-48 text-[11px] leading-relaxed">
                    {error.stack}
                  </pre>
                </details>
              )}
            </>
          )}

          <button
            onClick={() => this.setState({ error: null, componentStack: null })}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
