// @vitest-environment jsdom

// In the realtime tab a new answer is top-aligned: its first line goes to the top
// of the view, with a trailing spacer providing the room to get there. But that
// must not be mistaken for "the reader scrolled away" - which is why "following"
// is defined against the newest answer's position, not against the bottom.
//
// Scrolling up above the newest answer means the reader went back to older ones,
// and new answers must then leave the view alone.

const VIEWPORT = 300;
const ANSWER_HEIGHT = 500;

let AssistantView;

beforeAll(async () => {
    ({ AssistantView } = await import('../components/views/AssistantView.js'));
});

/**
 * Stand-in for .response-container. jsdom has no layout engine, so geometry is
 * simulated - faithfully: answer offsets/heights come from a model, scrollHeight
 * accounts for the tail spacer, and content only relayouts when innerHTML is set.
 */
function makeContainer() {
    const container = {
        clientHeight: VIEWPORT,
        scrollTop: 0,
        answerCount: 0,
        answerHeight: ANSWER_HEIGHT,
        spacerHeight: 0,
        pendingAnswerCount: 0,
        _html: '',
        _listeners: {},

        addEventListener(event, handler) {
            this._listeners[event] = handler;
        },
        removeEventListener(event) {
            delete this._listeners[event];
        },
        emitScroll() {
            this._listeners.scroll?.();
        },
        getBoundingClientRect() {
            return { top: 0, height: this.clientHeight };
        },
        get scrollHeight() {
            return this.answerCount * this.answerHeight + this.spacerHeight;
        },
        get lastAnswerOffset() {
            return Math.max(0, (this.answerCount - 1) * this.answerHeight);
        },

        querySelectorAll(selector) {
            if (selector === '.response-item') {
                return Array.from({ length: this.answerCount }, (_, i) => ({
                    getBoundingClientRect: () => ({
                        // Viewport-relative, exactly like a real rect.
                        top: i * this.answerHeight - this.scrollTop,
                        height: this.answerHeight,
                    }),
                }));
            }
            return [];
        },
        querySelector(selector) {
            if (selector === '.response-tail-spacer') return this._spacer;
            return null;
        },

        get innerHTML() {
            return this._html;
        },
        // Replacing content relayouts and resets scrollTop; the browser then
        // dispatches a scroll event asynchronously.
        set innerHTML(value) {
            this._html = value;
            this.answerCount = this.pendingAnswerCount;
            this.scrollTop = 0;
            queueMicrotask(() => this.emitScroll());
        },
    };

    // The spacer's height is written through style, as the component does.
    container._spacer = {
        style: {
            set height(value) {
                container.spacerHeight = parseInt(value, 10) || 0;
            },
            get height() {
                return `${container.spacerHeight}px`;
            },
        },
    };

    return container;
}

function mount({ followLatest, answerHeight = ANSWER_HEIGHT }) {
    const view = new AssistantView();
    // Keep Lit's own update scheduling out of it; updated() is invoked directly.
    view.requestUpdate = () => {};
    view.followLatest = followLatest;

    const container = makeContainer();
    container.answerHeight = answerHeight;
    Object.defineProperty(view, 'shadowRoot', {
        value: { querySelector: sel => (sel === '.response-container' || sel === '#responseContainer' ? container : null) },
        configurable: true,
    });

    view.firstUpdated();

    return {
        view,
        container,
        latestTop: () => container.lastAnswerOffset,
        userScrollTo(scrollTop) {
            container.scrollTop = scrollTop;
            container.emitScroll();
        },
        /** Mirrors AudioProcessApp.setResponse: appends a response AND moves the index. */
        arriveNewResponse(count) {
            container.pendingAnswerCount = count;
            const changed = new Map([
                ['responses', Array.from({ length: count - 1 }, (_, i) => `answer ${i}`)],
                ['currentResponseIndex', count - 2],
            ]);
            view.responses = Array.from({ length: count }, (_, i) => `answer ${i}`);
            view.currentResponseIndex = count - 1;
            view.shouldAnimateResponse = false;
            view.updated(changed);
        },
        navigateTo(index) {
            const changed = new Map([['currentResponseIndex', view.currentResponseIndex]]);
            view.currentResponseIndex = index;
            view.updated(changed);
        },
    };
}

// The scroll defers via setTimeout(0); the suppression flag clears on rAF.
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe('realtime transcript scroll behavior', () => {
    it('puts a new answer at the top of the view rather than the bottom', async () => {
        const h = mount({ followLatest: true });

        h.arriveNewResponse(3);
        await settle();

        expect(h.container.scrollTop).toBe(h.latestTop());
        // Not the bottom: the rest of the answer stays below the fold.
        expect(h.container.scrollTop).toBeLessThan(h.container.scrollHeight - h.container.clientHeight + 1);
    });

    it('adds trailing room so a short answer can still reach the top', async () => {
        const h = mount({ followLatest: true, answerHeight: 80 });

        h.arriveNewResponse(3);
        await settle();

        // Spacer fills the viewport minus the answer, so its top is reachable.
        expect(h.container.spacerHeight).toBe(VIEWPORT - 80);
        expect(h.container.scrollTop).toBe(h.latestTop());
        // And the reader can still scroll up into the older answers.
        expect(h.container.scrollTop).toBeGreaterThan(0);
    });

    it('keeps following across several consecutive answers', async () => {
        const h = mount({ followLatest: true });

        // Regression: a bottom-based follow test reports "scrolled away" the moment
        // we top-align, so following used to switch itself off after one answer.
        for (let count = 2; count <= 6; count++) {
            h.arriveNewResponse(count);
            await settle();
            expect(h.container.scrollTop, `after answer ${count}`).toBe(h.latestTop());
        }
    });

    it('keeps following when the reader scrolls down inside the newest answer', async () => {
        const h = mount({ followLatest: true });
        h.arriveNewResponse(3);
        await settle();

        // Reading further into the current answer is still following it.
        h.userScrollTo(h.latestTop() + 200);
        h.arriveNewResponse(4);
        await settle();

        expect(h.container.scrollTop).toBe(h.latestTop());
    });

    it('holds position when the reader has scrolled up to older answers', async () => {
        const h = mount({ followLatest: true });
        h.arriveNewResponse(4);
        await settle();

        h.userScrollTo(0);
        h.arriveNewResponse(5);
        await settle();

        expect(h.container.scrollTop).toBe(0);
    });

    it('holds position when scrolled just above the newest answer', async () => {
        const h = mount({ followLatest: true });
        h.arriveNewResponse(4);
        await settle();

        h.userScrollTo(h.latestTop() - 200);
        h.arriveNewResponse(5);
        await settle();

        expect(h.container.scrollTop).toBe(0);
    });

    it('tolerates being a little above the newest answer', async () => {
        const h = mount({ followLatest: true });
        h.arriveNewResponse(4);
        await settle();

        // Within FOLLOW_THRESHOLD_PX still counts as following.
        h.userScrollTo(h.latestTop() - 10);
        h.arriveNewResponse(5);
        await settle();

        expect(h.container.scrollTop).toBe(h.latestTop());
    });

    it('resumes following once the reader returns to the newest answer', async () => {
        const h = mount({ followLatest: true });
        h.arriveNewResponse(4);
        await settle();

        h.userScrollTo(0);
        h.arriveNewResponse(5);
        await settle();
        expect(h.container.scrollTop).toBe(0);

        h.userScrollTo(h.latestTop());
        h.arriveNewResponse(6);
        await settle();
        expect(h.container.scrollTop).toBe(h.latestTop());
    });

    it('scrolls to the newest answer when the reader asks a question', async () => {
        const h = mount({ followLatest: true });
        h.arriveNewResponse(4);
        await settle();
        h.userScrollTo(0);

        // handleSendText bails without a text input, but the follow override it
        // sets must survive the position re-sample.
        await h.view.handleSendText();

        h.arriveNewResponse(5);
        await settle();
        expect(h.container.scrollTop).toBe(h.latestTop());
    });

    it('still jumps to a response when the navigation arrows are used', async () => {
        const h = mount({ followLatest: true });
        h.arriveNewResponse(4);
        await settle();
        h.userScrollTo(0);

        let scrolledIndex = null;
        h.view.scrollToResponseItem = index => {
            scrolledIndex = index;
        };
        h.navigateTo(1);

        expect(scrolledIndex).toBe(1);
    });

    it('leaves the Gemini assistant view scrolling to the bottom, with no spacer', async () => {
        const h = mount({ followLatest: false });
        h.arriveNewResponse(4);
        await settle();
        h.userScrollTo(0);

        let scrolledIndex = null;
        h.view.scrollToResponseItem = index => {
            scrolledIndex = index;
        };
        h.arriveNewResponse(5);
        await settle();

        // Unchanged legacy behavior: bottom scroll plus scrollIntoView, no spacer.
        expect(h.container.spacerHeight).toBe(0);
        expect(h.container.scrollTop).toBe(h.container.scrollHeight);
        expect(scrolledIndex).toBe(4);
    });
});
