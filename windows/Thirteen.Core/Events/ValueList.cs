using System.Collections;
using System.Runtime.CompilerServices;

namespace Thirteen.Core.Events;

/// <summary>
/// An immutable list with value equality: two lists are equal when they hold equal items in the same
/// order. The events types use it for every list field, so records such as <see cref="RRule"/> and
/// <see cref="EventRecurrence"/> compare structurally, as the TypeScript engine's <c>plainEquals</c> does.
/// Build one from an array, a <see cref="List{T}"/> or a collection expression (<c>[1, 2]</c>).
/// </summary>
[CollectionBuilder(typeof(ValueList), nameof(ValueList.Create))]
public sealed class ValueList<T> : IReadOnlyList<T>, IEquatable<ValueList<T>>
{
    private readonly T[] _items;

    private ValueList(T[] items, bool owned)
    {
        _ = owned;
        _items = items;
    }

    /// <summary>A copy of <paramref name="items"/>.</summary>
    public ValueList(IEnumerable<T> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        _items = items.ToArray();
    }

    /// <summary>The empty list.</summary>
    public static ValueList<T> Empty { get; } = new([], owned: true);

    internal static ValueList<T> Wrap(T[] items) => items.Length == 0 ? Empty : new(items, owned: true);

    /// <summary>A copy of the array.</summary>
    public static implicit operator ValueList<T>(T[] items) => Wrap(items is null ? [] : (T[])items.Clone());

    /// <summary>A copy of the list.</summary>
    public static implicit operator ValueList<T>(List<T> items) => Wrap(items is null ? [] : items.ToArray());

    /// <inheritdoc />
    public int Count => _items.Length;

    /// <inheritdoc />
    public T this[int index] => _items[index];

    /// <inheritdoc />
    public IEnumerator<T> GetEnumerator() => ((IEnumerable<T>)_items).GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => _items.GetEnumerator();

    /// <summary>Equal items in the same order.</summary>
    public bool Equals(ValueList<T>? other)
    {
        if (other is null) return false;
        if (ReferenceEquals(this, other)) return true;
        if (_items.Length != other._items.Length) return false;
        var comparer = EqualityComparer<T>.Default;
        for (var i = 0; i < _items.Length; i++)
        {
            if (!comparer.Equals(_items[i], other._items[i])) return false;
        }
        return true;
    }

    /// <inheritdoc />
    public override bool Equals(object? obj) => obj is ValueList<T> other && Equals(other);

    /// <inheritdoc />
    public override int GetHashCode()
    {
        var hash = new HashCode();
        foreach (var item in _items) hash.Add(item);
        return hash.ToHashCode();
    }

    /// <summary>Value equality.</summary>
    public static bool operator ==(ValueList<T>? left, ValueList<T>? right) => left is null ? right is null : left.Equals(right);

    /// <summary>Value inequality.</summary>
    public static bool operator !=(ValueList<T>? left, ValueList<T>? right) => !(left == right);

    /// <summary><c>[a, b, c]</c>.</summary>
    public override string ToString() => "[" + string.Join(", ", _items) + "]";
}

/// <summary>Factory for <see cref="ValueList{T}"/> (the collection expression builder).</summary>
public static class ValueList
{
    /// <summary>A list holding a copy of <paramref name="items"/>.</summary>
    public static ValueList<T> Create<T>(ReadOnlySpan<T> items) => ValueList<T>.Wrap(items.ToArray());

    /// <summary>A list holding a copy of <paramref name="items"/>.</summary>
    public static ValueList<T> ToValueList<T>(this IEnumerable<T> items) => ValueList<T>.Wrap(items.ToArray());
}
