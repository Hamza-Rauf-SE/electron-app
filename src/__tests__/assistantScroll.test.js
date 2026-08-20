// @vitest-environment jsdom

// The realtime transcript must hold its position while the reader is scrolled up
// reading older answers, and resume following once they return to the bottom.
//
// Two scroll paths used to fight each other here (maybeScrollToBottom and
// scrollToResponseItem), and the decision has to survive the async scroll event
// that replacing innerHTML triggers - so this drives the real component.

const VIEWPORT = 300;
const HEIGHT_PER_RESPONSE = 500;

let AssistantView;

beforeAll(async () => {
    ({ AssistantView } = await import('../components/views/AssistantView.js'));
});

/**
 * A stand-in for .response-container. jsdom has no layout engine, so geometry is
 * simulated - faithfully: scrollHeight only grows when innerHTML is replaced,
 * which is exactly when the component has already sampled the scroll position.
 */
function makeContainer() {
    return {
        clientHeight: VIEWPORT,
        // Starts with no overflow, like the short welcome message does.
        scrollHeight: VIEWPORT,
        scrollTop: 0,
        pendingScrollHeight: VIEWPORT,
        _html: '',
        _listeners: {},
        addEventListener(event, handler) {
            this._listeners[event] = handler;
        },
        removeEventListener(event) {
            delete this._listeners[event];
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        emitScroll() {
            this._listeners.scroll?.();
        },
        get innerHTML() {
            return this._html;
        },
        // Replacing content relayouts and resets scrollTop, and the browser then
        // dispatches a scroll event asynchronously.
        set innerHTML(value) {
            this._html = value;
            this.scrollHeight = this.pendingScrollHeight;
            this.scrollTop = 0;
            queueMicrotask(() => this.emitScroll());
        },
    };
}

function mount({ stickToBottom }) {
    const view = new AssistantView();
    // Keep Lit's own update scheduling out of it; updated() is invoked directly.
    view.requestUpdate = () => {};
    view.stickToBottom = stickToBottom;

    const container = makeContainer();
    Object.defineProperty(view, 'shadowRoot', {
        value: { querySelector: sel => (sel === '.response-container' || sel === '#responseContainer' ? container : null) },
        configurable: true,
    });

    view.firstUpdated();

    return {
        view,
        container,
        maxScroll: () => container.scrollHeight - container.clientHeight,
        scrollToBottom() {
            container.scrollTop = container.scrollHeight - container.clientHeight;
            container.emitScroll();
        },
        userScrollTo(scrollTop) {
            container.scrollTop = scrollTop;
            container.emitScroll();
        },
        /** Mirrors AudioProcessApp.setResponse: appends a response AND moves the index. */
        arriveNewResponse(count) {
            container.pendingScrollHeight = HEIGHT_PER_RESPONSE * count;
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

// scrollToBottom() defers via setTimeout(0); the suppression flag clears on rAF.
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe('realtime transcript scroll behavior', () => {
    it('follows new answers while the reader is at the bottom', async () => {
        const h = mount({ stickToBottom: true });

        h.arriveNewResponse(2);
        await settle();
        expect(h.container.scrollTop).toBe(h.container.scrollHeight);
    });

    it('keeps following across several consecutive answers', async () => {
        const h = mount({ stickToBottom: true });

        // Regression: scrollToResponseItem used to land on the *top* of the newest
        // answer, which is not "at the bottom", so following switched itself off
        // after a single answer.
        for (let count = 2; count <= 6; count++) {
            h.arriveNewResponse(count);
            await settle();
            expect(h.container.scrollTop, `after answer ${count}`).toBe(h.container.scrollHeight);
        }
    });

    it('holds position when the reader has scrolled up to read older answers', async () => {
        const h = mount({ stickToBottom: true });
        h.arriveNewResponse(4);
        await settle();

        h.userScrollTo(0);
        h.arriveNewResponse(5);
        await settle();

        expect(h.container.scrollTop).toBe(0);
    });

    it('holds position when scrolled up past the threshold', async () => {
        const h = mount({ stickToBottom: true });
        h.arriveNewResponse(4);
        await settle();

        h.userScrollTo(h.maxScroll() - 200);
        h.arriveNewResponse(5);
        await settle();

        expect(h.container.scrollTop).toBe(0);
    });

    it('treats a near-bottom position as still following', async () => {
        const h = mount({ stickToBottom: true });
        h.arriveNewResponse(4);
        await settle();

        h.userScrollTo(h.maxScroll() - 10);
        h.arriveNewResponse(5);
        await settle();

        expect(h.container.scrollTop).toBe(h.container.scrollHeight);
    });

    it('resumes following once the reader scrolls back to the bottom', async () => {
        const h = mount({ stickToBottom: true });
        h.arriveNewResponse(4);
        await settle();

        h.userScrollTo(0);
        h.arriveNewResponse(5);
        await settle();
        expect(h.container.scrollTop).toBe(0);

        h.scrollToBottom();
        h.arriveNewResponse(6);
        await settle();
        expect(h.container.scrollTop).toBe(h.container.scrollHeight);
    });

    it('scrolls to the newest answer when the reader asks a question', async () => {
        const h = mount({ stickToBottom: true });
        h.arriveNewResponse(4);
        await settle();
        h.userScrollTo(0);

        // Drive the real path: handleSendText bails without a text input, but the
        // follow override it sets must survive the position re-sample.
        await h.view.handleSendText();

        h.arriveNewResponse(5);
        await settle();
        expect(h.container.scrollTop).toBe(h.container.scrollHeight);
    });

    it('still jumps to a response when the navigation arrows are used', async () => {
        const h = mount({ stickToBottom: true });
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

    it('leaves the Gemini assistant view always scrolling to the newest answer', async () => {
        const h = mount({ stickToBottom: false });
        h.arriveNewResponse(4);
        await settle();
        h.userScrollTo(0);

        let scrolledIndex = null;
        h.view.scrollToResponseItem = index => {
            scrolledIndex = index;
        };
        h.arriveNewResponse(5);
        await settle();

        // Unchanged legacy behavior: both scroll paths still fire.
        expect(h.container.scrollTop).toBe(h.container.scrollHeight);
        expect(scrolledIndex).toBe(4);
    });
});
