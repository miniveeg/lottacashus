import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { crashed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.crashed) {
      return (
        <div className="boot-screen">
          <div>
            <img src="/art/chip.webp" alt="" className="boot-chip" width={56} height={56} />
            <div className="boot-wordmark">LottaCash</div>
            <p className="boot-lede">Something broke on the floor</p>
            <button className="btn btn-gold" type="button" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
