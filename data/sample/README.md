# Sample data layout

Each data source uses the same directory structure:

```text
<data-source>/
├── raw/             # Local source data; ignored by Git
└── visualization/   # Visualization scripts and rendered images; tracked by Git
```

Put downloaded or otherwise unmodified source files in `raw/`. Keep the script
that reads those files and its rendered PNG output together in `visualization/`.
