from app.modules.resumes.latex_parser import assemble_latex, parse_latex

SAMPLE = r"""
\documentclass{article}
\usepackage{lmodern}
\begin{document}
\textbf{Rushi Patel} \\ rushi@example.com
\section{Experience}
\begin{itemize}
\item Built Python APIs
\item Trained image classification models
\end{itemize}
\section{Education}
\begin{itemize}
\item M.S. Computer Science, NYU, 2024
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


def test_title_block_and_education_are_frozen():
    parsed = parse_latex(SAMPLE)
    title = next(s for s in parsed.sections if s.name == "preamble_body")
    assert not title.editable
    education = next(s for s in parsed.sections if s.name == "Education")
    assert not education.editable
    assert all(not bullet.editable for bullet in education.bullets)
    assert next(s for s in parsed.sections if s.name == "Experience").editable


def test_edited_bullet_is_spliced_into_its_own_section():
    parsed = parse_latex(SAMPLE)
    experience = next(s for s in parsed.sections if s.name == "Experience")
    experience.bullets[0].latex_source = r"\item Built Python APIs serving 2M requests"

    rebuilt = assemble_latex(parsed.preamble, parsed.sections)

    assert r"\item Built Python APIs serving 2M requests" in rebuilt
    assert r"\item Built Python APIs" + "\n" not in rebuilt
    # The edit stays inside its own itemize; every other section is untouched.
    assert r"\item Trained image classification models" in rebuilt
    assert r"\section{Education}" in rebuilt
    assert r"\item M.S. Computer Science, NYU, 2024" in rebuilt
    assert "Python, SQL" in rebuilt
    assert rebuilt.count(r"\section{Experience}") == 1


def test_section_headers_are_split_off_from_editable_source():
    parsed = parse_latex(SAMPLE)
    for section in parsed.sections:
        if section.header_latex:
            # The command lives in header_latex only, so a rewrite of the section's
            # body can never overwrite the header's spelling.
            assert section.header_latex.startswith("\\section{")
            assert not section.latex_source.startswith("\\section{")
