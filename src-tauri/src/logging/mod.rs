use tracing_subscriber::EnvFilter;

pub fn init_logging() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("vibeytm=debug,info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .init();
}
