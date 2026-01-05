export const getSubscriptionCreatedEvent = () => ({
    event_type: "subscription.created",
    data: {
        id: "sub_123",
        customer_id: "cus_123",
        status: "active",
        items: [{ price: { id: "pri_123" } }],
        custom_data: { userId: "user_abc" },
        current_billing_period: { ends_at: "2025-01-01T00:00:00Z" }
    }
});

export const getSubscriptionCanceledEvent = () => ({
    event_type: "subscription.canceled",
    data: {
        id: "sub_123",
        custom_data: { userId: "user_abc" },
        canceled_at: "2024-01-01T00:00:00Z"
    }
});

export const getUserCancelRequestEvent = () => ({
    event_type: "user.cancel_subscription",
    data: {
        paddleSubscriptionId: "sub_to_cancel"
    }
});