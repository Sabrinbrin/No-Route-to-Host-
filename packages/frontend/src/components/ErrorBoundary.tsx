import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React error boundary — catches rendering errors in child components
 * and displays a friendly fallback UI instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '40vh', padding: 40, textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#14161b' }}>Something went wrong</h2>
          <p style={{ color: '#5b6472', fontSize: 14, maxWidth: 440, lineHeight: 1.6, margin: '0 0 20px' }}>
            The application encountered an unexpected error. This is likely a bug — please
            try refreshing the page.
          </p>
          <pre style={{
            background: '#0e1116', color: '#f85149', padding: '12px 18px', borderRadius: 10,
            fontSize: 12, fontFamily: 'var(--mono)', maxWidth: '90%', overflow: 'auto', textAlign: 'left',
          }}>
            {this.state.error?.message ?? 'Unknown error'}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20, padding: '10px 20px', borderRadius: 9, border: 'none',
              background: '#2e5cff', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
