from app.modules.resumes.latex_parser import assemble_latex, parse_latex

SAMPLE = r"""
\documentclass{article}
\usepackage{lmodern}
\begin{document}
\section{Experience}
\begin{itemize}
\item Built Python APIs
\item Trained image classification models
\end{itemize}
\section{Skills}
Python, SQL
\end{document}
"""


def test_parse_sections_and_bullets():
    parsed = parse_latex(SAMPLE)
    assert "documentclass" in parsed.preamble
    names = [s.name for s in parsed.sections]
    assert "Experience" in names
    assert "Skills" in names
    exp = next(s for s in parsed.sections if s.name == "Experience")
    assert len(exp.bullets) == 2
    assert "Python" in exp.bullets[0].text


def test_round_trip_keeps_section_commands():
    parsed = parse_latex(SAMPLE)
    rebuilt = assemble_latex(parsed.preamble, parsed.sections)
    assert "\\section{Experience}" in rebuilt
    assert "\\item Built Python APIs" in rebuilt
    assert "\\end{document}" in rebuilt
