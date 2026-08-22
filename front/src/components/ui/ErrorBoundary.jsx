import { Component } from "react";
import { translateMessage } from "../../i18n";
import { Button, Card, Stack, Typography } from "../../theme/ui";
import { reportClientError } from "../../utils/error-reporter";
import { getErrorMessage } from "../../utils/errors";
import { getSavedLanguage } from "../../utils/language";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled application error", error, info);
    reportClientError(error?.message || String(error), {
      source: "renderer.error-boundary",
      stack: error?.stack || info?.componentStack
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const t = (key) => translateMessage(getSavedLanguage(), key);
    return (
      <Stack
        as="main"
        role="alert"
        align="center"
        justify="center"
        sx={{ minBlockSize: "100vh", padding: "var(--space-8)" }}
      >
        <Card
          variant="neon"
          tilt={false}
          sx={{ maxInlineSize: "var(--content-max)", padding: "var(--space-8)" }}
        >
          <Stack gap="var(--space-4)">
            <Typography variant="caption">A&amp;D Voice</Typography>
            <Typography variant="h1">{t("error.screen.title")}</Typography>
            <Typography>{getErrorMessage(this.state.error, t("error.screen.body"))}</Typography>
            <Button onClick={() => window.location.reload()}>{t("error.screen.restart")}</Button>
          </Stack>
        </Card>
      </Stack>
    );
  }
}
