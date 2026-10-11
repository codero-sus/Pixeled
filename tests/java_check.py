#!/usr/bin/env python3
"""Static reference checker for the Java sources (there is no JDK in this workspace).

It parses every .java file with javalang and verifies that:

* every ``Class.member`` reference resolves to a member declared on that class (this is the check
  that caught the Android port calling ``Blocks.topColour`` before it existed);
* every ``local.member`` reference resolves against the declared type of that field or local;
* nested classes resolve as ``Outer.Inner`` even though javalang drops the qualifier on a
  declaration such as ``Raycast.Hit hit = Raycast.cast(...)``.

It is a typo trap, not a compiler — javac in CI is still the source of truth.
"""

import re
import sys
from pathlib import Path

import javalang
from javalang import tree


class ClassInfo:
    def __init__(self, name, package):
        self.name = name
        self.package = package
        self.qualified = '%s.%s' % (package, name) if package else name
        self.fields = {}        # name -> declared type (simple name)
        self.methods = {}       # name -> list of arities
        self.statics = set()    # names reachable as Class.member, including nested types
        self.nested = {}        # nested class name -> its member names
        self.extends_foreign = False
        self.path = None

    def members(self):
        known = set(self.fields) | set(self.methods) | self.statics
        for names in self.nested.values():
            known |= names
        return known


def strip_literals(source):
    """Blanks out string/char literals and comments so identifier regexes stay honest."""
    out = list(source)
    index = 0
    while index < len(out):
        char = out[index]
        if char in '"\'':
            quote = char
            out[index] = ' '
            index += 1
            while index < len(out) and out[index] != quote:
                if out[index] == '\\':
                    out[index] = ' '
                    index += 1
                if index < len(out):
                    out[index] = ' '
                    index += 1
            if index < len(out):
                out[index] = ' '
            index += 1
        elif char == '/' and index + 1 < len(out) and out[index + 1] == '/':
            while index < len(out) and out[index] != '\n':
                out[index] = ' '
                index += 1
        elif char == '/' and index + 1 < len(out) and out[index + 1] == '*':
            while index + 1 < len(out) and not (out[index] == '*' and out[index + 1] == '/'):
                out[index] = ' '
                index += 1
            out[index:index + 2] = [' ', ' ']
            index += 1
        else:
            index += 1
    return ''.join(out)


def nested_members(node):
    names = set()
    for member in node.body:
        if isinstance(member, tree.MethodDeclaration):
            names.add(member.name)
        elif isinstance(member, tree.FieldDeclaration):
            names.update(declarator.name for declarator in member.declarators)
    return names


def build_classes(files):
    """Returns (by_qualified, by_simple_per_package)."""
    by_qualified = {}
    by_simple = {}
    for path in files:
        try:
            unit = javalang.parse.parse(path.read_text())
        except Exception as error:  # noqa: BLE001
            print('PARSE FAIL %s: %s' % (path, error))
            continue
        package = unit.package.name if unit.package else ''
        for _, node in unit:
            if not isinstance(node, tree.ClassDeclaration):
                continue
            info = ClassInfo(node.name, package)
            info.path = path
            parent = getattr(node, 'extends', None)
            parent_name = getattr(parent, 'name', None) if parent is not None else None
            info.extends_foreign = bool(parent_name) and parent_name not in by_simple.get(package, {})
            for member in node.body:
                if isinstance(member, tree.FieldDeclaration):
                    type_name = getattr(member.type, 'name', None) or ''
                    for declarator in member.declarators:
                        info.fields[declarator.name] = type_name
                        if 'static' in member.modifiers:
                            info.statics.add(declarator.name)
                elif isinstance(member, tree.MethodDeclaration):
                    info.methods.setdefault(member.name, []).append(len(member.parameters or []))
                    if 'static' in member.modifiers:
                        info.statics.add(member.name)
                elif isinstance(member, tree.ClassDeclaration):
                    info.statics.add(member.name)
                    info.nested[member.name] = nested_members(member)
            by_qualified[info.qualified] = info
            by_simple.setdefault(package, {})[info.name] = info
    return by_qualified, by_simple


def declared_fields_with_types(path, package, by_simple):
    """Field and local names -> declared type, for the members of this file."""
    unit = javalang.parse.parse(path.read_text())
    types = {}
    for _, node in unit:
        if isinstance(node, tree.VariableDeclaration):
            type_name = (getattr(node.type, 'name', None) or '').split('.')[-1]
            for declarator in node.declarators:
                types[declarator.name] = type_name
    return types


def check_file(path, package, by_simple):
    source = strip_literals(path.read_text())
    problems = []
    known_classes = by_simple.get(package, {})

    for match in re.finditer(r'(?<![\w.])([A-Z]\w*)\.([A-Za-z_]\w*)', source):
        owner, member = match.group(1), match.group(2)
        info = known_classes.get(owner)
        if info is None:
            continue
        if member not in info.members():
            line = source[:match.start()].count('\n') + 1
            problems.append('line %d: %s.%s is not declared on %s' % (line, owner, member, owner))

    local_types = declared_fields_with_types(path, package, by_simple)
    for name, type_name in local_types.items():
        info = known_classes.get(type_name)
        if info is None or info.extends_foreign:
            continue  # inherited members are out of scope for this checker
        for match in re.finditer(r'(?<![\w.])%s\.([A-Za-z_]\w*)' % re.escape(name), source):
            member = match.group(1)
            if member not in info.members():
                line = source[:match.start()].count('\n') + 1
                problems.append('line %d: %s.%s is not declared on %s' % (line, name, member, type_name))
    return problems


def main():
    roots = sys.argv[1:] or ['java/pixeled', 'rockz-android/app/src']
    files = []
    for root in roots:
        files.extend(sorted(Path(root).rglob('*.java')))
    by_qualified, by_simple = build_classes(files)
    print('parsed %d files, %d classes' % (len(files), len(by_qualified)))
    total = 0
    for path in files:
        unit = javalang.parse.parse(path.read_text())
        package = unit.package.name if unit.package else ''
        for problem in check_file(path, package, by_simple):
            print('%s: %s' % (path, problem))
            total += 1
    print('%d problems' % total)
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main())
