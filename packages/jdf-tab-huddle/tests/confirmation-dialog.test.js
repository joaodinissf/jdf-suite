// Simplified tests for confirmation dialog behavior
describe('Confirmation Dialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup minimal DOM for testing
    document.body.innerHTML = `
      <div id="windowCount">Loading...</div>
      <ul id="operationList"></ul>
      <button id="confirmButton">Confirm</button>
      <button id="cancelButton">Cancel</button>
    `;
    
    // Mock URL parameters
    Object.defineProperty(window, 'location', {
      value: { search: '?extractable=2&single=3' },
      writable: true
    });
  });

  describe('Dialog Functions', () => {
    test('updateContent should be defined and callable', () => {
      expect(typeof updateContent).toBe('function');
      expect(() => updateContent()).not.toThrow();
    });

    test('setupEventListeners should be defined and callable', () => {
      expect(typeof setupEventListeners).toBe('function');
      expect(() => setupEventListeners()).not.toThrow();
    });

    test('respond function should send Chrome messages', () => {
      expect(typeof respond).toBe('function');
      
      respond(true);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'extractAllDomainsConfirmation',
        confirmed: true
      });
      
      respond(false);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'extractAllDomainsConfirmation',
        confirmed: false
      });
    });
  });

  describe('DOM Updates', () => {
    test('updateContent should update DOM elements', () => {
      const windowCountEl = document.getElementById('windowCount');
      const confirmButtonEl = document.getElementById('confirmButton');
      
      updateContent();
      
      // Should update the text content
      expect(windowCountEl.textContent).not.toBe('Loading...');
      expect(confirmButtonEl.textContent).toContain('Create');
    });

    test('setupEventListeners should attach click handlers', () => {
      const confirmBtn = document.getElementById('confirmButton');
      const cancelBtn = document.getElementById('cancelButton');
      
      // Mock addEventListener to verify it's called
      confirmBtn.addEventListener = jest.fn();
      cancelBtn.addEventListener = jest.fn();
      
      setupEventListeners();
      
      expect(confirmBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
      expect(cancelBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    });
  });

  describe('Error Handling', () => {
    test('respond should handle Chrome API errors gracefully', () => {
      chrome.runtime.sendMessage.mockImplementation(() => {
        throw new Error('Chrome API error');
      });
      
      window.close = jest.fn();
      
      expect(() => respond(true)).not.toThrow();
      expect(window.close).toHaveBeenCalled();
    });
  });
});