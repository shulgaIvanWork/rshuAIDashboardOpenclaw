module.exports = {
  apps: [
    {
      name: 'clover-web',
      cwd: '/root/.openclaw/workspace/projects/web-interface',
      script: 'server.js',
      env: { PORT: 3000 }
    },
    {
      name: 'rshu-dashboard',
      cwd: '/root/.openclaw/workspace/projects/rshu-dashboard',
      script: 'server.js',
      env: {
        BITRIX_BASE: 'https://24.uprav.ru/rest/479/a98jbqufylu1si1e/'
      }
    },
    {
      name: 'drop-dashboard',
      cwd: '/root/.openclaw/workspace/projects/drop-dashboard',
      script: 'server.js'
    },
    {
      name: 'kom-dashboard',
      cwd: '/root/.openclaw/workspace/projects/kom-dashboard',
      script: 'server.js'
    },
};
