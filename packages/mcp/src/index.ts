import packageJson from '../package.json' with { type: 'json' };

export const MCP_SERVER_INFO = Object.freeze({
  name: 'liasse',
  version: packageJson.version,
});
