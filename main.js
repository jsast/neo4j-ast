const neo4j = require('neo4j-driver').v1;
const esprima = require('esprima');
const escodegen = require('escodegen');
const R = require('ramda');
const async = require('async');
const fs = require('fs');

const credentials = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const driver = neo4j.driver(
  "bolt://localhost",
  neo4j.auth.basic(credentials.username, credentials.password)
);

// driver.onComplete = () => {
  console.log('Driver online');
  // fs.readFile('input.js', 'utf8', (err, code) => {
  fs.readFile('main.js', 'utf8', (err, code) => {
    if (err) {
      throw err;
    }

    const program = esprima.parse(code, { loc: true });
    storeLink({ parentName: null, name: 'root', node: program });

    // TODO: Do this in a callback
    setTimeout(() => driver.close(), 5000);
  });
// }

driver.onError = (error) => {
  console.log('Driver instantiation failed', error);
};


// db.cypher({
//     query: 'MATCH (user:User {email: {email}}) RETURN user',
//     params: {
//         email: 'alice@example.com',
//     },
// }, callback);

var id = 0;

function getId() {
  id += 1;
  return id;
}

function nodeIdentifier({ loc: { start: { line, column }}}) {
  id += 1;
  return id;
  // return `${line}:${column}`;
}

function storeLink({ parentName, name, node }) {
  // Process the AST-Node
  // to get its data and links (to other AST-Nodes)
  const { data, links } = exportNode(node);

  // TODO: share sessions?
  const session = driver.session();

  const id = getId();
  const nodeName = 'Node' + id; 

  session
    .run(
      `CREATE (\`${nodeName}\`:${node.type} {data})`,
      { data: R.assoc('id', id, data) }
    )
    .then((res) => {
      if (parentName != null) {
        console.log(
          `MATCH (par {id: ${parentName}})\nMATCH (cur {id: ${id}})\nCREATE (par)-[:${name}]->(cur)`
        )
        return session.run(
        //   // `CREATE (\`${parentName}\`)-[:${name}]->(\`${nodeName}\`)`
          `MATCH (par {id: ${parentName}})\nMATCH (cur {id: ${id}})\nCREATE (par)-[:${name}]->(cur)`
        );
      }
    })
    .then((res) => {
      console.log("done");
      session.close();
      links.forEach(({ name, node }) => {
        storeLink({ parentName: id, name, node });
      })
    })
    .catch((err) => {
      throw err;
    });

  // return new Promise((resolve, reject) => {
  //   // Store links in series, otherwise importing files with lots of links
  //   // will lead to an error because to many files are opened at once
  //   // (maybe the connections to the api count as files, too)
  //   async.mapLimit(links, 4, (link, cb) => {
  //     this.storeLink(link).then(res => cb(null, res)).catch(err => cb(err));
  //   },
  //   (err, result) => {
  //     if (err) {
  //       reject(err);
  //     } else {
  //       resolve(result);
  //     }
  //   });
  //   // // recursively call storeLink on all links,
  //   // links.map(this.storeLink)
  // }).then(ipfsLinks => {
  //   // create an ipfs object
  //   // w/ data and the IPFS-links from the previous step
  //   return this.putObject({
  //     Data: JSON.stringify(data),
  //     Links: ipfsLinks
  //   })
  // }).then(ipfsNode => {
  //   // then return a valid DAGLink object
  //   return {
  //     Name: name,
  //     Size: ipfsNode.size,
  //     Hash: ipfsNode.toJSON().multihash,
  //   };
  // })
};

function makeExporter(dataKeys, linkKeys) {
  return (node) => {
    const links = [];
    // const data =  R.pick(['type', ...dataKeys], node);
    const data =  R.pick(dataKeys, node);

    linkKeys.forEach(key => {
      const value = node[key]
        if (value instanceof Array) {
          if (value.length == 0) {
            data[key] = [];
          } else {
            // const newLinks = value.map((e, i) => ({ name: `${key}[${i}]`, node: e }));
            const newLinks = value.map((e, i) => ({ name: `${key}`, node: e }));
            links.push(...newLinks);
          }
        } else if (value != null) {
          links.push({ name: key, node: value })
        } else {
          data[key] = null;
        }
    })

    return { data, links }
  }
}

exporters = {
  'Program':             makeExporter(['sourceType'], ['body']),
  // TODO: Handle `regex?`
  'Literal':             makeExporter(['value', 'raw'], []),
  'ThisExpression':      makeExporter([], []),
  'Identifier':   makeExporter(['name'], []),
  'Super':   makeExporter([], []),
  'Import':   makeExporter([], []),
  'ArrayPattern':   makeExporter([], ['elements']),
  'RestElement':   makeExporter([], ['argument']),
  'AssignmentPattern':   makeExporter([], ['left', 'right']),
  'ObjectPattern':   makeExporter([], ['properties']),
  'ArrayExpression':   makeExporter([], ['elements']),
  'ObjectExpression':   makeExporter([], ['properties']),
  'Property':   makeExporter(['computed', 'kind', 'method', 'shorthand'], ['key', 'value']),
  'FunctionExpression':   makeExporter(['generator', 'async', 'expression'], ['id', 'params', 'body']),
  'ArrowFunctionExpression':   makeExporter(['generator', 'async', 'expression'], ['id', 'params', 'body']),
  'ClassExpression':   makeExporter([], ['id', 'superClass', 'body']),
  'ClassBody':   makeExporter([], ['body']),
  'MethodDefinition':   makeExporter(['computed', 'kind', 'static'], ['key', 'value']),
  'TaggedTemplateExpression':   makeExporter([], ['readonly tag', 'readonly quasi']),
  'TemplateElement':   makeExporter(['value', 'tail'], []),
  'TemplateLiteral':   makeExporter([], ['quasis', 'expressions']),
  'MemberExpression':   makeExporter(['computed'], ['object', 'property']),
  'MetaProperty':   makeExporter([], ['meta', 'property']),
  'CallExpression':   makeExporter([], ['callee', 'arguments']),
  'NewExpression':   makeExporter([], ['callee', 'arguments']),
  'SpreadElement':   makeExporter([], ['argument']),
  'UpdateExpression':   makeExporter(['operator', 'prefix'], ['argument']),
  'AwaitExpression':   makeExporter([], ['argument']),
  'UnaryExpression':   makeExporter(['operator', 'prefix'], ['argument']),
  'BinaryExpression':    makeExporter(['operator'], ['left', 'right']),
  'LogicalExpression':    makeExporter(['operator'], ['left', 'right']),
  // TODO: Handle / test optional `alternate?`
  'ConditionalExpression':   makeExporter([], ['test', 'consequent', 'alternate']),
  'YieldExpression':   makeExporter(['delegate'], ['argument']),
  'AssignmentExpression':   makeExporter(['operator'], ['left', 'right']),
  'SequenceExpression':   makeExporter([], ['expressions']),
  'BlockStatement':   makeExporter([], ['body']),
  'BreakStatement':   makeExporter([], ['label']),
  'ClassDeclaration':   makeExporter([], ['id', 'superClass', 'body']),
  'ContinueStatement':   makeExporter([], ['label']),
  'DebuggerStatement':   makeExporter([], []),
  'DoWhileStatement':   makeExporter([], ['body', 'test']),
  'EmptyStatement':   makeExporter([], []),
  'ExpressionStatement': makeExporter([], ['expression']),
  'ForStatement':   makeExporter([], ['init', 'test', 'update', 'body']),
  'ForInStatement':   makeExporter(['each'], ['left', 'right', 'body']),
  'ForOfStatement':   makeExporter([], ['left', 'right', 'body']),
  'FunctionDeclaration':   makeExporter(['generator', 'async', 'expression'], ['id', 'params', 'body']),
  // TODO: Handle / test optional `alternate?`
  'IfStatement':   makeExporter([], ['test', 'consequent', 'alternate']),
  'LabeledStatement':   makeExporter([], ['label', 'body']),
  'ReturnStatement':   makeExporter([], ['argument']),
  'SwitchStatement':   makeExporter([], ['discriminant', 'cases']),
  'SwitchCase':   makeExporter([], ['test', 'consequent']),
  'ThrowStatement':   makeExporter([], ['argument']),
  'TryStatement':   makeExporter([], ['block', 'handler', 'finalizer']),
  'CatchClause':   makeExporter([], ['param', 'body']),
  'VariableDeclaration':   makeExporter(['kind'], ['declarations']),
  'VariableDeclarator':   makeExporter([], ['id', 'init']),
  'WhileStatement':   makeExporter([], ['test', 'body']),
  'WithStatement':   makeExporter([], ['object', 'body']),
  // TODO: Handle / test optional `imported?`
  'ImportSpecifier':   makeExporter([], ['local', 'imported']),
  // TODO: Handle / test optional `imported?`
  'ImportDefaultSpecifier':   makeExporter([], ['local', 'imported']),
  // TODO: Handle / test optional `imported?`
  'ImportNamespaceSpecifier':   makeExporter([], ['local', 'imported']),
  'ExportAllDeclaration':   makeExporter([], ['source']),
  'ExportDefaultDeclaration':   makeExporter([], ['declaration']),
  'ExportNamedDeclaration':   makeExporter([], ['declaration', 'specifiers', 'source']),
  'ExportSpecifier':   makeExporter([], ['exported', 'local']),
  'ImportDeclaration':   makeExporter([], ['specifiers', 'source']),
}

function exportNode(node) {
  const exporter = exporters[node.type];
  if (exporter != undefined) {
    return exporter(node)
  } else {
    throw 'Unknown node type: ' + node.type;
  }
}

