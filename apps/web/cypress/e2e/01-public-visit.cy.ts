describe('Public Page Navigation and Verification', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  context('Landing Page ("/") Verification', () => {
    it('should load successfully and display core hero elements', () => {
      cy.contains('h1', /Detect your text/i).should('be.visible');
      cy.contains('h1', /in Seconds!/i).should('be.visible');
      cy.contains('p', /Provide your text, and our model will predict its classification/i).should(
        'be.visible',
      );
      cy.contains(/Introducing Detect AI/i).should('be.visible');
      cy.contains(/AI Detection in Progress/i).should('be.visible');
      cy.contains(/Analyzing patterns.../i).should('be.visible');
    });

    it('should display the main call-to-action button linking to signup', () => {
      cy.contains('button', /Get started!/i)
        .should('be.visible')
        .closest('a')
        .should('have.attr', 'href', '/signup');
    });
  });

  context('Navigation to Signup Page ("/signup")', () => {
    it('should navigate via landing page CTA and display structure', () => {
      cy.contains('button', /Get started!/i).click();
      cy.url().should('include', '/signup');
      cy.contains('h1', /Get Started/i).should('be.visible');
      cy.contains(/Create a new account/i).should('be.visible');
      cy.contains('button', /Google/i).should('be.visible');
      cy.contains('button', /GitHub/i).should('be.visible');
      cy.contains(/or continue with email/i).should('be.visible');
      cy.contains('label', /First Name/i).should('be.visible');
      cy.contains('label', /Last Name/i).should('be.visible');
      cy.contains('label', /Email/i).should('be.visible');
      cy.contains('label', /^Password/i).should('be.visible');
      cy.contains('label', /Confirm Password/i).should('be.visible');
      cy.contains('button', /Create Account/i).should('be.visible');
      cy.contains('a', /Already have an account\? Login here./i)
        .should('be.visible')
        .and('have.attr', 'href', '/login');
    });
  });

  context('Navigation to Login Page ("/login")', () => {

    it('should navigate from Signup page and display structure', () => {
      cy.visit('/signup');
      cy.contains('a', /Already have an account\? Login here./i).click();

      cy.url().should('include', '/login');
      cy.contains('h1', /Welcome Back/i).should('be.visible');
      cy.contains(/Sign In/i).should('be.visible');
      cy.contains('button', /Google/i).should('be.visible');
      cy.contains('button', /GitHub/i).should('be.visible');
      cy.contains('label', /Email/i).should('be.visible');
      cy.contains('label', /^Password/i).should('be.visible');
      cy.contains('button', /Sign in/i).should('be.visible');
      cy.contains('a', /Don't have an account\? Sign up here./i)
        .should('be.visible')
        .and('have.attr', 'href', '/signup');
    });
  });

  context('Navigation back to Signup from Login', () => {
    it('should navigate from Login page back to Signup page', () => {
      cy.visit('/login');
      cy.contains('a', /Don't have an account\? Sign up here./i).click();

      cy.url().should('include', '/signup');
      cy.contains('h1', /Get Started/i).should('be.visible');
    });
  });

  // context('Navigation to Docs Page ("/docs")', () => {
  //   it('should navigate via Navbar and display specific content', () => {
  //     cy.visit('/docs');
  //     cy.url().should('include', '/docs');
  //     cy.contains('h2', /DetectAI API Documentation/i).should('be.visible').wait(2000);
  //     cy.contains(
  //       'p',
  //       /API documentation for the DetectAI Next\.js application, covering authentication, user management, model interactions, and billing./i,
  //     ).should('be.visible');
  //   });
  // });
});