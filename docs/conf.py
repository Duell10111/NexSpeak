# Sphinx configuration of the user documentation (Read the Docs, see .readthedocs.yaml).
# Pages are Markdown (MyST); beta-plan.md is planning for contributors and stays out.
project = "NexSpeak"
author = "Konstantin Späth"
copyright = "2026, Konstantin Späth"

extensions = ["myst_parser", "sphinx_copybutton"]
myst_enable_extensions = ["colon_fence", "deflist", "strikethrough"]
# Only HTML is built (Read the Docs), where strikethrough works.
suppress_warnings = ["myst.strikethrough"]
# Anchors for "page.md#heading" links.
myst_heading_anchors = 3

exclude_patterns = ["_build", "beta-plan.md", "requirements.txt"]

html_theme = "furo"
html_title = "NexSpeak"
html_logo = "../apps/web/src/app/icon.svg"
html_favicon = "../apps/web/src/app/icon.svg"
html_theme_options = {
    "source_repository": "https://github.com/Duell10111/NexSpeak/",
    "source_branch": "main",
    "source_directory": "docs/",
}
