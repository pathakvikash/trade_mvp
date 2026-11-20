test('apiBase strips trailing slashes', () => {
  process.env.REACT_APP_API_URL = 'https://api.example.com//';
  jest.isolateModules(() => { expect(require('../lib/apiBase').API).toBe('https://api.example.com'); });
});
