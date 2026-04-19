namespace Example;

public class User
{
    public string Name { get; set; }
    public int Id { get; set; }
}

public record UserDto(string Name, int Id);
