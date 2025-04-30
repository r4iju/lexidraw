import {
  LexicalEditor,
  ElementNode,
  DecoratorNode,
  type Klass,
  type LexicalNode,
} from "lexical";

// Helper type to satisfy Klass constraint
type LexicalNodeKlass = Klass<LexicalNode>;

export function makeRuntimeSpec(editor: LexicalEditor) {
  // 1. node types
  const nodeKlassMap = editor._nodes;
  const nodeClasses: LexicalNodeKlass[] = Array.from(nodeKlassMap.values()).map(
    (entry) => entry.klass,
  );

  const nodes = nodeClasses
    .filter(
      (cls): cls is Klass<ElementNode | DecoratorNode<React.JSX.Element>> => {
        return (
          typeof cls.getType === "function" &&
          (cls.prototype instanceof ElementNode ||
            cls.prototype instanceof DecoratorNode)
        );
      },
    )
    .map((cls) => {
      const proto = cls.prototype as
        | ElementNode
        | DecoratorNode<React.JSX.Element>; // Cast needed based on filtering
      const type = cls.getType();

      // Check for instance methods, not static ones on the class
      const instanceMethods = Object.getOwnPropertyNames(proto).filter(
        (p) =>
          // Include relevant setters
          (/^set[A-Z]/.test(p) ||
            // Include other potentially useful methods like 'insert', 'append', etc.
            /^(insert|append|replace|select)/.test(p)) &&
          // Exclude constructor and potentially internal methods
          p !== "constructor" &&
          !p.startsWith("__"),
      );

      // Determine specific node kind
      const isElement = proto instanceof ElementNode;
      const isDecorator = proto instanceof DecoratorNode;
      const isInline = isElement ? (proto as ElementNode).isInline() : false; // isInline is only on ElementNode

      return {
        type,
        isInline,
        isElement,
        isDecorator,
        methods: instanceMethods,
      };
    });

  // 2. commands
  // Access commands map directly
  const commands = Array.from(editor._commands.keys());

  return { nodes, commands };
}
