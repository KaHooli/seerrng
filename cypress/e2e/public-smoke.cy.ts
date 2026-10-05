describe('Public app smoke checks', () => {
  const visitLoginWithoutConsoleErrors = (width: number, height: number) => {
    const errors: string[] = [];

    cy.viewport(width, height);
    cy.visit('/login', {
      onBeforeLoad(win) {
        cy.stub(win.console, 'error').callsFake((...args) => {
          errors.push(args.map(String).join(' '));
        });
      },
    });

    cy.get('[data-testid=email]').should('be.visible');
    cy.get('[data-testid=password]').should('be.visible');
    cy.get('[data-testid=local-signin-button]').should('be.visible');
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(
        document.documentElement.clientWidth
      );
    });
    cy.then(() => expect(errors, 'browser console errors').to.deep.equal([]));
  };

  it('renders the login experience cleanly on desktop', () => {
    visitLoginWithoutConsoleErrors(1440, 900);
  });

  it('renders the login experience cleanly on mobile', () => {
    visitLoginWithoutConsoleErrors(390, 844);
  });

  it('wraps a long login backdrop title instead of widening the page', () => {
    cy.intercept('GET', '/api/v1/backdrops', {
      body: [
        {
          path: '/smoke-backdrop.jpg',
          title:
            'An Unusually Long Trending Title That Would Overflow A Single Line Of Text',
          year: 2026,
          mediaType: 'movie',
        },
      ],
    }).as('backdrops');
    cy.viewport(1440, 900);
    cy.visit('/login');
    cy.wait('@backdrops');
    cy.get('.auth-backdrop-title')
      .should('be.visible')
      .and('contain.text', 'An Unusually Long Trending Title');
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(
        document.documentElement.clientWidth
      );
    });
  });

  it('redirects signed-out visitors to login', () => {
    cy.visit('/');
    cy.location('pathname').should('eq', '/login');
  });

  it('serves public settings without stale browser reuse', () => {
    cy.request('/api/v1/settings/public').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.include({ initialized: true });
      expect(response.headers['cache-control']).to.include('no-store');
    });
  });
});
